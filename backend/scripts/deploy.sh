#!/usr/bin/env bash
# Deploy backend updates to production (Digital Ocean droplet).
# Run on the droplet: sudo bash /opt/fpl-refresh/backend/scripts/deploy.sh
# Or from local: ssh root@DROPLET_IP 'sudo bash /opt/fpl-refresh/backend/scripts/deploy.sh'
#
# Assumes repo is cloned at /opt/fpl-refresh (so backend is /opt/fpl-refresh/backend).

set -e

REPO_ROOT="/opt/fpl-refresh"
BACKEND_DIR="$REPO_ROOT/backend"
VENV_PIP="$REPO_ROOT/venv/bin/pip"
SERVICE="fpl-refresh.service"

echo "==> Deploying FPL refresh from main..."
cd "$REPO_ROOT"

echo "==> Pulling latest from main..."
sudo -u fpl git fetch origin
sudo -u fpl git checkout main
sudo -u fpl git pull origin main

echo "==> Installing/updating Python dependencies..."
sudo -u fpl "$VENV_PIP" install -r "$BACKEND_DIR/requirements.txt" --quiet

echo "==> Restarting $SERVICE..."
sudo systemctl restart "$SERVICE"

echo "==> Status:"
sudo systemctl status "$SERVICE" --no-pager
echo ""
echo "Done. Follow logs with: sudo journalctl -u $SERVICE -f"
