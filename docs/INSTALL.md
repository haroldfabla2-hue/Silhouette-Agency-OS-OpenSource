# Installation Guide - Silhouette Agency OS

This guide will help you get Silhouette Agency OS up and running on your local machine or server.

## Prerequisites
- **Node.js**: v18 or higher.
- **npm**: v9 or higher.
- **Docker & Docker Compose** (Recommended for easiest setup).
- **API Keys**: You will need at least one LLM provider (Gemini or Minimax).

---

## Option 1: Docker Deployment (Recommended) 🐳

Docker is the preferred way to run Silhouette as it handles all dependencies (Redis, Neo4j, Qdrant) automatically.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/silhouette-agency-os.git
   cd silhouette-agency-os
   ```

2. **Run the Setup Wizard**:
   The wizard will create your config and `.env` files.
   ```bash
   npm run setup
   ```

3. **Start the containers**:
   ```bash
   docker-compose up -d
   ```

4. **Access the UI**:
   Open your browser at `http://localhost:3005`.

---

## Option 2: Local Installation (Manual) 🛠️

If you prefer to run the services outside of Docker, follow these steps:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Setup Environment**:
   Run the interactive wizard:
   ```bash
   npm run setup
   ```

3. **Start Core Services**:
   Ensure you have Redis, Neo4j, and Qdrant running locally, then start the bot:
   ```bash
   npm run dev
   ```

---

## Server Deployment (Ubuntu) 🐧

For deployment on a remote Ubuntu server:
1. Follow the **Docker Deployment** steps above.
2. Ensure port `3005` is open in your firewall (e.g., `ufw allow 3005`).
3. If using Telegram, ensure your server has outbound internet access.
4. **Note**: The `getScreenshot` tool requires a GUI or Xvfb to function on headless servers.

---

## Troubleshooting
- **Port Conflicts**: If port 3005 is taken, change it in `silhouette.config.json`.
- **API Errors**: Ensure your keys are valid and have sufficient quota in `.env.local`.
- **Database Connection**: Check Docker logs if the bot can't reach Neo4j: `docker-compose logs bot`.
