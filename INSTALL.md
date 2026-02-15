# Installation Guide: Silhouette Agency OS

This guide provides detailed instructions for setting up and running **Silhouette Agency OS** on your local machine or via Docker.

## 📋 Prerequisites

Ensure you have the following installed:

- **Node.js**: v18.0.0 or higher.
- **npm**: v9.0.0 or higher.
- **Git**: For version control.
- **Neo4j**: Community or Enterprise edition (local or cloud).
- **Redis**: Local or cloud instance.
- **Python 3.10+**: Optional, required for specialized video generation and training modules.

## 🚀 Quick Start (Local Setup)

### 1. Clone the Repository
```bash
git clone https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-v2.git
cd Silhouette-Agency-OS-v2
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy the example environment file and fill in your API keys and service URLs:
```bash
cp .env.example .env.local
```
> [!IMPORTANT]
> At minimum, you need a `GEMINI_API_KEY`. See `CONFIGURATION.md` for more details on optional providers.

### 4. Initialize Database
Run the following script to set up necessary Neo4j indexes and constraints:
```bash
npx tsx scripts/init_neo4j_indexes.ts
```

### 5. Run the Application
Start both the frontend and backend in development mode:
```bash
npm run dev
```
- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3005](http://localhost:3005)

---

## 🏗️ Docker Setup

Silhouette is fully containerized for easy deployment.

### 1. Build and Start
```bash
docker-compose up --build
```
This command starts:
- Silhouette OS Core
- Neo4j Database
- Redis Cache
- ComfyUI (optional, based on profile)

### 2. Verify
Check the container status:
```bash
docker ps
```

---

## ⚡ Lite Mode (Resource Optimized)

If you have limited RAM (less than 16GB) or want a faster startup, you can run in **Lite Mode**, which disables heavy modules until needed:

```bash
# In your .env.local or silhouette.config.json
MODULES_GRAPH=false
MODULES_BROWSER=false
```

---

## 🔧 Troubleshooting

- **Neo4j Connection Failed**: Ensure the Neo4j service is running and the credentials in `.env.local` are correct.
- **Port Conflict**: If `3005` or `5173` are in use, change them in `package.json` and `vite.config.ts`.
- **Module Not Found**: Try clearing the cache: `npm cache clean --force && rm -rf node_modules && npm install`.

---

## 📖 Further Documentation

- **[README.md](README.md)**: Project overview and architecture.
- **[CONFIGURATION.md](docs/CONFIGURATION.md)**: Detailed API provider setup.
- **[USAGE_GUIDE.md](docs/USAGE_GUIDE.md)**: How to interact with the system.
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: Guidelines for contributing.

---
**Silhouette Agency OS** — *Cognition meets Creation.*
