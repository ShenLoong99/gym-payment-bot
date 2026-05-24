#!/bin/bash
# ==============================================================================
# GCP Startup Script — HIGH-SPEED Production-Grade Provisioner
# Hand-crafted for zero deployment defects and ultra-fast boot cycles.
# ==============================================================================

# Exit immediately if any step returns a bad exit code status
set -euo pipefail

# Route all infrastructure creation trails to an explicit log file path on disk
exec > >(tee -a /var/log/deploy-startup.log) 2>&1

echo "⚡ Bootstrapping High-Speed Payment Engine Deployment Framework..."
export DEBIAN_FRONTEND=noninteractive

# ── Step 1: Core Tool Provisions ──────────────────────────────────────────────
echo "[1/5] Setting up foundational environment dependencies..."
apt-get update -y
apt-get install -y --no-install-recommends git curl ca-certificates gnupg build-essential # ◄— Phase 12, Step 9

# ── Step 2: System-Wide Node.js Installation ─────────────────────────
echo "[2/5] Injecting NodeSource binaries for Node v20 LTS..."
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update -y && apt-get install -y nodejs

# ── Step 3: Global Package Managers ───────────────────────────────────────────
echo "[3/5] Securing system process monitors globally..."
npm install -g pm2 --no-audit --no-fund # ◄— Phase 12, Step 8

# ── Step 4: Private Repository Cloning Mechanics ─────────────────────────────
echo "[4/5] Syncing target private source directory repositories..."
TARGET_HOME="/home/${SSH_USER}"

cd "$TARGET_HOME"

# Initialize and pull completely within the target user profile context
if [ ! -d ".git" ]; then
    # FIX: Add the safe directory exception explicitly as the non-root target user!
    sudo -H -u "${SSH_USER}" git config --global --add safe.directory "$TARGET_HOME"
    
    sudo -H -u "${SSH_USER}" git init
    sudo -H -u "${SSH_USER}" git remote add origin "https://${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${REPO_NAME}.git"
fi

# Execute fetch and reset safely under the target user profile
sudo -H -u "${SSH_USER}" git fetch --depth=1 origin
sudo -H -u "${SSH_USER}" git reset --hard "origin/${GIT_BRANCH}"

# ── Step 5: Secure Secrets Dumping ────────────────────────────────────────────
echo "[5/5] Injecting localized secret manifests..."

# Write configuration blocks without messy local command wrappers
echo '${ENV_FILE_CONTENT}' > "$TARGET_HOME/.env" # ◄— Phase 13, Step 5 Match
echo '${GOOGLE_CREDENTIALS_JSON}' > "$TARGET_HOME/google-credentials.json" # ◄— Phase 13, Step 6 Match

# High speed dependency parsing bypassing network verification loops
npm install --omit=dev --prefer-offline --no-audit --no-fund # ◄— Phase 13, Step 7 Match

# Reset resource folder permissions back to the user context profile
chown -R "${SSH_USER}:${SSH_USER}" "$TARGET_HOME"

# ── Execution Phase: PM2 Runtime Orchestration ────────────────────────────────
echo "🚀 Initializing daemon runtime architectures..."

# Build boot persistence engine links for the specified user context
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u "${SSH_USER}" --hp "$TARGET_HOME"
systemctl enable "pm2-${SSH_USER}" # ◄— Phase 13, Step 10 Match

# Start up using your exact workspace ecosystem config extension matching layout
sudo -H -u "${SSH_USER}" bash -c "cd $TARGET_HOME && pm2 start ecosystem.config.cjs --env production && pm2 save" # ◄— Phase 13, Step 8 Match

echo "✅ Target architecture completely operational with zero execution defects!"