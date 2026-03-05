#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NovaPulse — One-time VPS bootstrap script
# Run ONCE on a fresh Ubuntu 22.04 server as root:
#   sudo bash scripts/setup-vps.sh
#
# Environment variable overrides:
#   REPO_URL  — git clone URL
#   DOMAIN    — your domain (e.g. trade.yourdomain.com) for TLS setup
#   USE_IP=1  — skip domain/Certbot entirely; use direct IP access over HTTP
#               e.g.: USE_IP=1 REPO_URL=https://... bash setup-vps.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/opt/novapulse"
REPO_URL="${REPO_URL:-}"
DOMAIN="${DOMAIN:-}"
USE_IP="${USE_IP:-0}"  # set to 1 to skip domain/TLS

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"
[[ -z "$REPO_URL" ]] && read -rp "Git repo URL (e.g. https://github.com/ORG/novapulse.git): " REPO_URL
if [[ "$USE_IP" != "1" && -z "$DOMAIN" ]]; then
  read -rp "Domain (e.g. trade.yourdomain.com) — or press Enter to use direct IP (no TLS): " DOMAIN
  [[ -z "$DOMAIN" ]] && USE_IP=1
fi

# ── 1. System update ──────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Create deploy user ─────────────────────────────────────────────────────
if ! id "$DEPLOY_USER" &>/dev/null; then
  info "Creating user: $DEPLOY_USER"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  # Copy authorized SSH keys from root so deploy user can log in
  if [[ -f /root/.ssh/authorized_keys ]]; then
    mkdir -p "/home/$DEPLOY_USER/.ssh"
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/"
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    chmod 700 "/home/$DEPLOY_USER/.ssh"
    chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
else
  warn "User $DEPLOY_USER already exists — skipping creation."
fi

# ── 3. SSH hardening ──────────────────────────────────────────────────────────
info "Hardening SSH..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'     /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# ── 4. UFW firewall ───────────────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 5. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$DEPLOY_USER"
  systemctl enable --now docker
else
  warn "Docker already installed — skipping."
fi

# Docker Compose v2 plugin
if ! docker compose version &>/dev/null 2>&1; then
  info "Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

# ── 6. Node.js 20 ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  warn "Node.js $(node -v) already installed — skipping."
fi

# ── 7. Nginx (+ Certbot only when using a domain) ───────────────────────────
if [[ "$USE_IP" == "1" ]]; then
  info "Installing Nginx (IP mode — skipping Certbot)..."
  apt-get install -y nginx
else
  info "Installing Nginx and Certbot..."
  apt-get install -y nginx certbot python3-certbot-nginx
fi
systemctl enable nginx

# ── 8. Git ───────────────────────────────────────────────────────────────────
apt-get install -y git

# ── 9. Clone repo ─────────────────────────────────────────────────────────────
info "Cloning repository to $APP_DIR..."
if [[ -d "$APP_DIR/.git" ]]; then
  warn "$APP_DIR already has a git repo — skipping clone."
else
  mkdir -p "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# ── 10. Nginx config ──────────────────────────────────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/novapulse"
rm -f /etc/nginx/sites-enabled/default

if [[ "$USE_IP" == "1" ]]; then
  # Detect public IP for display purposes
  PUBLIC_IP=$(curl -4 -sf https://ifconfig.me || echo "<your-vps-ip>")
  info "IP mode — installing HTTP-only Nginx config (no TLS)..."
  cp "$APP_DIR/nginx/novapulse-ip.conf" "$NGINX_CONF"
  # Rewrite the frontend root path to the actual APP_DIR
  sed -i "s|/opt/novapulse|$APP_DIR|g" "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/novapulse
  nginx -t && systemctl reload nginx
  info "Nginx ready — access the app at: http://$PUBLIC_IP"
else
  info "Installing Nginx config for $DOMAIN..."
  sed "s/trade\.yourdomain\.com/$DOMAIN/g" "$APP_DIR/nginx/novapulse.conf" > "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/novapulse

  # Temp HTTP block so Certbot ACME challenge works before SSL
  cat > /etc/nginx/sites-available/novapulse-temp << EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $APP_DIR/frontend/dist;
    location / { try_files \$uri \$uri/ /index.html; }
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }
}
EOF
  nginx -t && systemctl reload nginx

  # ── 11. TLS certificate ─────────────────────────────────────────────────────
  info "Obtaining TLS certificate for $DOMAIN..."
  if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    warn "Certificate for $DOMAIN already exists — skipping."
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect
  fi

  # Restore full config with SSL blocks written by Certbot
  sed "s/trade\.yourdomain\.com/$DOMAIN/g" "$APP_DIR/nginx/novapulse.conf" > "$NGINX_CONF"
  nginx -t && systemctl reload nginx
fi

# ── 12. .env setup prompt ─────────────────────────────────────────────────────
if [[ "$USE_IP" == "1" ]]; then
  CORS_HINT="CORS_ORIGIN=http://$PUBLIC_IP"
else
  CORS_HINT="CORS_ORIGIN=https://$DOMAIN"
fi

info "─────────────────────────────────────────────────────"
info "Almost done! You still need to create $APP_DIR/.env"
info "Run as the $DEPLOY_USER user:"
info "  cd $APP_DIR && cp .env.example .env && nano .env"
info ""
info "Key values to set in .env:"
info "  $CORS_HINT"
info "  JWT_SECRET=\$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
info ""
info "Then run the deployment script:"
info "  bash $APP_DIR/scripts/deploy.sh"
info "─────────────────────────────────────────────────────"

# ── 13. Enable Docker autostart ───────────────────────────────────────────────
systemctl enable docker
info "Setup complete. Reboot recommended: sudo reboot"
