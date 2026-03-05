#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NovaPulse — Deployment script
# Run on the VPS (as deploy user) for first deploy AND every subsequent update:
#   bash /opt/novapulse/scripts/deploy.sh
#
# Environment variables (all optional overrides):
#   APP_DIR   — repo root (default: /opt/novapulse)
#   BRANCH    — git branch to deploy (default: main)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/novapulse}"
BRANCH="${BRANCH:-main}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
section() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

cd "$APP_DIR"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
section "Pre-flight"
[[ -f ".env" ]] || error ".env not found at $APP_DIR/.env — copy .env.example and fill in values."
command -v docker &>/dev/null || error "Docker not installed. Run scripts/setup-vps.sh first."
command -v node   &>/dev/null || error "Node.js not installed. Run scripts/setup-vps.sh first."
info "All pre-flight checks passed."

# ── Git pull ──────────────────────────────────────────────────────────────────
section "Git pull ($BRANCH)"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [[ "$LOCAL" == "$REMOTE" ]]; then
  warn "Already up to date ($LOCAL). Continuing anyway (env/config may have changed)."
else
  git pull origin "$BRANCH"
  info "Updated $(git rev-parse --short HEAD~1)..$(git rev-parse --short HEAD)"
fi

# ── Build frontend ────────────────────────────────────────────────────────────
section "Frontend build"
cd "$APP_DIR/frontend"
npm ci --silent
npm run build
info "Frontend built → $APP_DIR/frontend/dist"
cd "$APP_DIR"

# ── Docker: pull base images & rebuild changed services ───────────────────────
section "Docker build & restart"
docker compose pull --quiet mongodb redis 2>/dev/null || true
docker compose build --no-cache backend ml-service
docker compose up -d --remove-orphans

# ── Wait for backend health ────────────────────────────────────────────────────
section "Health check"
MAX_WAIT=60
ELAPSED=0
info "Waiting for backend at http://127.0.0.1:3100/api/status ..."
until curl -sf http://127.0.0.1:3100/api/status > /dev/null 2>&1; do
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    warn "Backend did not respond within ${MAX_WAIT}s — check logs:"
    warn "  docker compose logs --tail 50 backend"
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done
[[ $ELAPSED -lt $MAX_WAIT ]] && info "Backend is healthy."

# ── Nginx reload (picks up any updated config) ────────────────────────────────
section "Nginx reload"
if sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx
  info "Nginx reloaded."
else
  warn "Nginx config test failed — skipping reload. Run 'sudo nginx -t' for details."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
section "Deployment complete"
docker compose ps
echo ""
info "Commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
info "Logs:   docker compose logs -f backend"
info "Logs:   docker compose logs -f ml-service"
