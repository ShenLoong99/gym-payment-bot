#!/bin/bash
# ==============================================================================
# GCP Startup Script — Production-Grade Provisioner
# ==============================================================================

set -uo pipefail
exec > >(tee -a /var/log/deploy-startup.log) 2>&1

# Granular failure reporting — prints the line number and reason before exiting
die() { echo "❌ FATAL at line $1: $2"; exit 1; }

echo "================================================================"
echo "  GCP Startup Provisioner — $(date --utc '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Running as: $(whoami)"
echo "================================================================"

export DEBIAN_FRONTEND=noninteractive
TARGET_HOME="/home/${SSH_USER}"

# ── Step 1: Core Dependencies ─────────────────────────────────────────────────
echo ""
echo "[1/5] Installing system dependencies..."

apt-get update -y || die $LINENO "apt-get update failed"

apt-get install -y --no-install-recommends \
  git curl ca-certificates gnupg build-essential \
  || die $LINENO "apt-get install failed"

echo "[1/5] ✅ System dependencies installed."

# ── Step 2: Node.js 20 LTS via NodeSource ────────────────────────────────────
echo ""
echo "[2/5] Installing Node.js 20 LTS..."

mkdir -p /etc/apt/keyrings

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  || die $LINENO "NodeSource GPG key import failed"

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt-get update -y || die $LINENO "apt-get update (nodesource) failed"
apt-get install -y nodejs || die $LINENO "nodejs install failed"

echo "[2/5] ✅ Node $(node --version) installed at $(which node)"

# ── Step 3: PM2 Global Install ────────────────────────────────────────────────
echo ""
echo "[3/5] Installing PM2 globally..."

if npm install -g pm2 --no-audit --no-fund; then
  echo "[3/5] ✅ PM2 $(pm2 --version) installed at $(which pm2)"
else
  die $LINENO "PM2 global install failed"
fi

# ── Step 4: Clone Private Repository ─────────────────────────────────────────
echo ""
echo "[4/5] Cloning application repository..."

# Allow git to operate in this directory as the target user
sudo -H -u "${SSH_USER}" git config --global --add safe.directory "$TARGET_HOME" \
  || die $LINENO "git safe.directory config failed"

cd "$TARGET_HOME"

if [ ! -d ".git" ]; then
  if sudo -H -u "${SSH_USER}" git init \
    && sudo -H -u "${SSH_USER}" git remote add origin \
      "https://${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${REPO_NAME}.git"; then
    echo "[4/5] Git repo initialised."
  else
    die $LINENO "git init or remote add failed"
  fi
fi

if sudo -H -u "${SSH_USER}" git fetch --depth=1 origin \
  && sudo -H -u "${SSH_USER}" git reset --hard "origin/${GIT_BRANCH}"; then
  echo "[4/5] ✅ Repository synced to branch: ${GIT_BRANCH}"
else
  die $LINENO "git fetch or reset failed"
fi

# ── Step 5: Inject Secrets ────────────────────────────────────────────────────
echo ""
echo "[5/5] Writing secret manifests..."

# ✅ FIX: Double quotes allow Terraform templatefile() variable substitution
# ✅ FIX: printf instead of echo — handles JSON newlines and special chars safely
printf '%s' "${ENV_FILE_CONTENT}" > "$TARGET_HOME/.env" \
  || die $LINENO "Failed to write .env file"

printf '%s' "${GOOGLE_CREDENTIALS_JSON}" > "$TARGET_HOME/google-credentials.json" \
  || die $LINENO "Failed to write google-credentials.json"

echo "[5/5] ✅ Secret manifests written."

# ── npm install as the target user ───────────────────────────────────────────
echo ""
echo "📦 Installing application dependencies..."

# ✅ FIX: Run as SSH_USER, not root — prevents node_modules permission errors
if sudo -H -u "${SSH_USER}" bash -c "cd $TARGET_HOME && npm install --omit=dev --no-audit --no-fund"; then
  echo "✅ npm dependencies installed."
else
  die $LINENO "npm install failed"
fi

# Fix ownership of everything before PM2 starts
chown -R "${SSH_USER}:${SSH_USER}" "$TARGET_HOME"

# ── PM2 Startup Hook Registration ────────────────────────────────────────────
echo ""
echo "🔧 Registering PM2 systemd boot hook..."

if env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u "${SSH_USER}" --hp "$TARGET_HOME"; then
  echo "✅ PM2 startup unit file generated."
else
  die $LINENO "pm2 startup systemd unit generation failed"
fi

if systemctl enable "pm2-${SSH_USER}"; then
  echo "✅ PM2 systemd service enabled for ${SSH_USER}."
else
  die $LINENO "systemctl enable pm2-${SSH_USER} failed"
fi

# ── Start Application via PM2 ─────────────────────────────────────────────────
echo ""
echo "🚀 Starting application..."

if sudo -H -u "${SSH_USER}" bash -c \
  "cd $TARGET_HOME && pm2 start ecosystem.config.cjs --env production && pm2 save"; then
  echo "✅ Application started and PM2 process list saved."
else
  die $LINENO "pm2 start or pm2 save failed"
fi

# ── Final Verification ────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  ✅ PROVISIONING COMPLETE — $(date --utc '+%Y-%m-%d %H:%M:%S UTC')"
echo "  node → $(node --version)"
echo "  npm  → $(npm --version)"
echo "  pm2  → $(pm2 --version)"
echo "  app  → $(sudo -H -u "${SSH_USER}" bash -c 'pm2 list --no-color' | grep -c online) process(es) online"
echo "================================================================"