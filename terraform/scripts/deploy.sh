#!/bin/bash
# ==============================================================================
# GCP Startup Script — System-Wide Node.js + PM2 Provisioner
# Runs as: root
# Execution log: /var/log/startup-script.log (GCP Guest Agent default)
#                /var/log/cloud-init-output.log (cloud-init path)
# ==============================================================================

# -e  : Exit immediately on any command failure
# -u  : Treat unset variables as errors (catches typos in var names)
# -o pipefail : A pipe fails if ANY command in it fails, not just the last
set -euo pipefail

# Redirect ALL output (stdout + stderr) to a dedicated log for easier debugging.
# This supplements the GCP serial console log.
exec > >(tee -a /var/log/deploy-startup.log) 2>&1

echo "================================================================"
echo "  GCP Startup Provisioner — $(date --utc '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Running as: $(whoami) | Shell: $SHELL"
echo "================================================================"

# ── Step 1: System Updates ────────────────────────────────────────────────────
echo ""
echo "[1/4] Running system updates..."

# DEBIAN_FRONTEND=noninteractive prevents apt from blocking on dialog prompts
# (e.g., kernel upgrade confirmation, grub device selection)
export DEBIAN_FRONTEND=noninteractive

apt-get update -y

# -yq: yes + quiet. The \-o flags suppress the "restart services?" prompt
# that appears in Ubuntu 22.04+ during upgrades.
apt-get upgrade -yq \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold"

apt-get install -y --no-install-recommends \
  git \
  curl \
  ca-certificates \
  gnupg \
  build-essential

echo "[1/4] ✅ System updates complete."

# ── Step 2: Node.js 18 LTS via NodeSource (System-Wide) ──────────────────────
echo ""
echo "[2/4] Installing Node.js 18 LTS via NodeSource..."

# WHY NodeSource instead of NVM:
# - This startup script runs as root.
# - NVM installs into a user's $HOME (~/.nvm) and hooks into .bashrc/.zshrc.
# - As root, NVM would install into /root/.nvm — invisible to the ubuntu user.
# - NodeSource installs node/npm into /usr/bin, accessible system-wide to ALL
#   users, services, and future PM2 process restarts on reboot.

# Download and add the NodeSource signing key + repo for Node 18
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] \
  https://deb.nodesource.com/node_18.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt-get update -y
apt-get install -y nodejs

# Verify the installations are on PATH and working
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
NODE_PATH=$(which node)

echo "[2/4] ✅ Node.js installed: $NODE_VERSION at $NODE_PATH"
echo "[2/4] ✅ npm installed:     $NPM_VERSION"

# ── Step 3: PM2 Global Install ────────────────────────────────────────────────
echo ""
echo "[3/4] Installing PM2 globally..."

# npm -g installs to /usr/lib/node_modules and symlinks to /usr/bin/pm2
# This is system-wide and survives reboots, unlike a per-user NVM install.
npm install -g pm2

PM2_VERSION=$(pm2 --version)
PM2_PATH=$(which pm2)

echo "[3/4] ✅ PM2 installed: $PM2_VERSION at $PM2_PATH"

# ── Step 4: PM2 Systemd Startup Hook ─────────────────────────────────────────
echo ""
echo "[4/4] Configuring PM2 systemd boot integration for user: ${SSH_USER}..."

# Run the pm2 systemd unit installation directly as root — no TTY needed
if env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u "${SSH_USER}" --hp "/home/${SSH_USER}"; then
  echo "[4/4] ✅ PM2 startup unit file generated."
else
  die $LINENO "pm2 startup systemd unit generation failed"
fi

if systemctl enable pm2-${SSH_USER}; then
  echo "[4/4] ✅ PM2 systemd hook registered and enabled for ${SSH_USER}."
else
  die $LINENO "systemctl enable pm2-${SSH_USER} failed"
fi

# ── Final Verification ────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  PROVISIONING COMPLETE — $(date --utc '+%Y-%m-%d %H:%M:%S UTC')"
echo "================================================================"
echo "  node   → $(node --version) @ $(which node)"
echo "  npm    → $(npm --version)  @ $(which npm)"
echo "  pm2    → $(pm2 --version)  @ $(which pm2)"
echo "================================================================"
echo ""
echo "  To verify from SSH:"
echo "    sudo cat /var/log/deploy-startup.log"
echo "    sudo journalctl -u google-startup-scripts.service"
echo "================================================================"