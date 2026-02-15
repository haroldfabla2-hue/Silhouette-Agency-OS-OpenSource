# 💼 GUÍA DE IMPLEMENTACIÓN: Deploy a Producción
## Infrastructure, DevOps y Release Management

**Nivel:** DevOps Engineers / Tech Leads  
**Versión:** 2.0  
**Fecha:** 28 Diciembre 2025

---

## 1. INFRASTRUCTURE SETUP

### 1.1 AWS Architecture

```
┌─────────────────────────────────────────────────┐
│              CloudFront CDN                     │
│         (Edge caching, DDoS protection)        │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────┴─────────────┐  ┌────────┴──────────┐
│  S3 (Static Assets) │  │ Application Load  │
│  • JS bundles       │  │ Balancer (ALB)    │
│  • CSS/fonts        │  │ • Route /api → EC2│
│  • Images           │  │ • Route / → S3    │
│  • Videos           │  └────────┬──────────┘
└─────────────────────┘           │
                          ┌───────┴───────────┐
                          │ ECS Cluster       │
                          ├─ API Server 1    │
                          ├─ API Server 2    │
                          ├─ API Server 3    │
                          └─────────┬─────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
            ┌───────┴────┐   ┌──────┴──────┐  ┌────┴─────┐
            │ RDS        │   │ ElastiCache │  │ EBS      │
            │ Postgres   │   │ Redis       │  │ Models   │
            │ Multi-AZ   │   │ Cluster     │  │ (15GB)   │
            └────────────┘   └─────────────┘  └──────────┘
```

### 1.2 EC2 Instance Setup

```bash
# Launch EC2 Instance
AMI: Deep Learning AMI (Ubuntu 22.04)
Instance: g4dn.xlarge (GPU: 1x NVIDIA T4 16GB)
EBS: 100GB (gp3, SSD)
Security Group: Allow 8000 (API), 5173 (frontend)

# Initial Setup
#!/bin/bash
cd /opt

# 1. Install dependencies
sudo apt-get update
sudo apt-get install -y python3.11 python3-pip git

# 2. Clone repo
git clone https://github.com/brandistry/nexus-canvas.git
cd nexus-canvas

# 3. Setup Python environment
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 4. Download ML models (takes 30 min)
python3 scripts/download_models.py

# 5. Start API
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 1.3 RDS Postgres Database

```bash
# Create RDS Instance
Engine: PostgreSQL 15
Instance: db.t4g.medium (2 vCPU, 4GB RAM)
Storage: 100GB gp3
Multi-AZ: Yes (for production)
Backup: 30-day retention

# Connect and initialize
psql -h nexus-canvas-db.xxx.us-east-1.rds.amazonaws.com \
     -U admin \
     -d nexus_canvas

# Run migrations
python3 -m alembic upgrade head
```

---

## 2. DOCKER & CONTAINERIZATION

### 2.1 Dockerfile (Multi-stage)

```dockerfile
# Stage 1: Builder
FROM nvidia/cuda:12.0-devel-ubuntu22.04 as builder

WORKDIR /build

# Install build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    python3.11 \
    python3-pip \
    git

# Copy requirements
COPY requirements.txt .

# Install Python deps (cached layer)
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime (smaller image)
FROM nvidia/cuda:12.0-runtime-ubuntu22.04

WORKDIR /app

# Copy only what we need
COPY --from=builder /root/.local /root/.local
COPY app/ ./app/
COPY scripts/ ./scripts/

# Python path
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Expose port
EXPOSE 8000

# Run
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 2.2 Docker Compose (Development)

```yaml
version: '3.8'

services:
  # API Server
  api:
    build: .
    container_name: nexus-api
    ports:
      - "8000:8000"
    environment:
      DEBUG: "false"
      DATABASE_URL: postgresql://admin:password@postgres:5432/nexus_canvas
      REDIS_URL: redis://redis:6379/0
      LOG_LEVEL: info
    volumes:
      - ./app:/app/app
      - ./logs:/app/logs
    depends_on:
      - postgres
      - redis
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: nexus-postgres
    environment:
      POSTGRES_DB: nexus_canvas
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secure_password_here
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: nexus-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

---

## 3. CI/CD PIPELINE (GitHub Actions)

### 3.1 Automated Testing

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov
      
      - name: Run tests
        env:
          DATABASE_URL: postgresql://test:test@localhost/test_db
        run: |
          pytest tests/ -v --cov=app --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd packages/ui && npm install
      
      - name: Run tests
        run: cd packages/ui && npm run test
      
      - name: Build check
        run: cd packages/ui && npm run build
```

### 3.2 Automated Deployment

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      # Build Docker image
      - name: Build Docker image
        run: |
          docker build -t nexus-api:${{ github.sha }} .
      
      # Push to ECR
      - name: Push to ECR
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          aws ecr get-login-password --region us-east-1 | \
          docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}
          
          docker tag nexus-api:${{ github.sha }} \
            ${{ secrets.ECR_REGISTRY }}/nexus-api:${{ github.sha }}
          
          docker push ${{ secrets.ECR_REGISTRY }}/nexus-api:${{ github.sha }}
      
      # Deploy to ECS
      - name: Deploy to ECS
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          aws ecs update-service \
            --cluster nexus-cluster \
            --service nexus-api-service \
            --force-new-deployment \
            --region us-east-1
      
      # Notify Slack
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          payload: |
            {
              "text": "✅ Nexus Canvas deployed to production",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Deployment Successful\nCommit: ${{ github.sha }}"
                  }
                }
              ]
            }
```

---

## 4. MONITORING & LOGGING

### 4.1 CloudWatch Setup

```python
# app/logging.py
import logging
from pythonjsonlogger import jsonlogger

# JSON logging for better CloudWatch parsing
logger = logging.getLogger()
handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)
logger.addHandler(handler)

# CloudWatch metrics
import boto3
cloudwatch = boto3.client('cloudwatch')

def record_metric(metric_name: str, value: float):
    cloudwatch.put_metric_data(
        Namespace='NexusCanvas',
        MetricData=[
            {
                'MetricName': metric_name,
                'Value': value,
                'Unit': 'Count'
            }
        ]
    )
```

### 4.2 Error Tracking (Sentry)

```python
# app/main.py
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    integrations=[FastApiIntegration()],
    traces_sample_rate=0.1,
    environment=os.getenv("ENVIRONMENT", "production")
)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )
```

---

## 5. SCALING & AUTO-SCALING

### 5.1 Auto Scaling Groups (AWS)

```python
# Auto-scale based on CPU + GPU metrics
# Min: 2 instances
# Max: 10 instances
# Target CPU: 70%
# Target GPU VRAM: 80%

# Scale up: Add instance if 2 above thresholds
# Scale down: Remove instance if 5 min below thresholds
```

### 5.2 Load Balancing

```nginx
# Nginx configuration (if not using ALB)

upstream api_backends {
    least_conn;
    server 10.0.1.10:8000;
    server 10.0.1.11:8000;
    server 10.0.1.12:8000;
}

server {
    listen 80;
    server_name api.nexuscanvas.com;

    location / {
        proxy_pass http://api_backends;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 6. BACKUP & DISASTER RECOVERY

### 6.1 Database Backup

```bash
# Daily automated backups via RDS
# 30-day retention
# Point-in-time recovery

# Manual backup script
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump -h $DB_HOST -U $DB_USER $DB_NAME | \
  gzip > backups/nexus_${TIMESTAMP}.sql.gz

# Upload to S3
aws s3 cp backups/nexus_${TIMESTAMP}.sql.gz \
  s3://nexus-backups/
```

### 6.2 Disaster Recovery Plan

```
RTO (Recovery Time Objective): 4 hours
RPO (Recovery Point Objective): 1 hour

Failure Scenario: DB corrupted
└─ 1. Restore from S3 backup
   2. Start new RDS instance
   3. Point API to new DB
   4. Verify data
   (Total: ~2 hours)

Failure Scenario: API server down
└─ 1. ALB automatically routes to healthy servers
   2. Auto-scaling spins up new instance
   3. New instance joins cluster
   (Total: <5 minutes, automatic)
```

---

## 7. PRODUCTION CHECKLIST

Before going live:

- [ ] Database backups automated
- [ ] SSL certificates valid (ACM)
- [ ] CDN cache configured
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] HTTPS only (no HTTP)
- [ ] Security headers set (CSP, HSTS, etc)
- [ ] API key rotation scheduled
- [ ] Monitoring alerts active
- [ ] Load testing passed (1000+ users)
- [ ] Incident response plan documented
- [ ] Team on-call schedule set
- [ ] Rollback procedure tested
- [ ] Documentation complete
- [ ] Change log updated

---

## 8. POST-LAUNCH MONITORING

### Week 1
- [ ] Monitor error rate (<0.1%)
- [ ] Check latency (<200ms p99)
- [ ] Verify AI inference time (<15s)
- [ ] Database performance
- [ ] User feedback collection

### Week 2-4
- [ ] Capacity planning (scale if >70% CPU)
- [ ] Performance optimization
- [ ] Feature flag rollouts (if needed)
- [ ] Regular security audits

---

**Ready for production launch** 🚀

