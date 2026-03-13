# Silhouette Agency OS - Systemd Deployment Guide

This directory contains native Linux Systemd configuration files to deploy Silhouette OS as a rock-solid, auto-restarting background daemon on production servers (like Ubuntu/Debian).

## 🚀 Installation 

1. Edit the service files `silhouette-core.service` and `silhouette-ui.service` to match your server environment:
   - Change `User=silhouette` and `Group=silhouette` to your SSH user (e.g. `User=ubuntu` or `User=root`).
   - Change `WorkingDirectory=/opt/Silhouette-Agency-OS-OpenSource` to the absolute path where you cloned the repository.
   - Verify that `/usr/bin/npm` is the correct path for Node/NPM by running `which npm`.

2. Link or copy the files to the Systemd directory:
```bash
sudo cp deploy/systemd/silhouette-core.service /etc/systemd/system/
sudo cp deploy/systemd/silhouette-ui.service /etc/systemd/system/
```

3. Reload the systemd daemon to recognize the new files:
```bash
sudo systemctl daemon-reload
```

4. Enable them to auto-start on server boot:
```bash
sudo systemctl enable silhouette-core
sudo systemctl enable silhouette-ui
```

5. Start the processes:
```bash
sudo systemctl start silhouette-core
sudo systemctl start silhouette-ui
```

---

## 🔍 Reading Logs & Monitoring

Instead of `pm2 logs`, Native Linux uses `journalctl`:

**To see real-time logs for the Core (Brain/Orchestrator):**
```bash
sudo journalctl -u silhouette-core -f
```

**To see real-time logs for the UI:**
```bash
sudo journalctl -u silhouette-ui -f
```

**To check the status (Running/Failed):**
```bash
sudo systemctl status silhouette-core
```
