# Base Image: Python 3.10 Slim (Balance size/compatibility)
FROM python:3.10-slim

# Working Directory
WORKDIR /app

# System Dependencies (build-essential for compiling some python libs)
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy Requirements first for caching
COPY requirements.txt .

# Install Python Dependencies
# We use --no-cache-dir to keep image small
RUN pip install --no-cache-dir -r requirements.txt

# Copy Application Code
COPY . .

# Expose Port
EXPOSE 8000

# Run Command (Uvicorn)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
