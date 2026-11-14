#!/usr/bin/env bash
set -euo pipefail

# Copies this repo to the AWS box and builds + starts the Orbit containers there.
# Same model as the Unifesto deploy: nothing goes through a registry.
#   ./deploy/deploy.sh
#
# Needs the box's env files already in ~/orbit (api.env, web.env, galaxy.env).
# Caddy is the Unifesto stack's and is reloaded from the Unifesto repo, not here.

SERVER="${SERVER:-ubuntu@i-079d51280d1964117}"
KEY="${KEY:-$HOME/.ssh/unifesto-key.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/orbit}"
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=30)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> syncing source to $SERVER:$REMOTE_DIR/src"
tar -C "$ROOT" \
  --exclude=node_modules --exclude=.git --exclude=docs --exclude='*.log' --exclude='.env*' \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "$SERVER" "rm -rf $REMOTE_DIR/src && mkdir -p $REMOTE_DIR/src && tar -C $REMOTE_DIR/src -xzf -"

echo "==> copying compose file"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/docker-compose.yml" "$SERVER:$REMOTE_DIR/docker-compose.yml"

echo "==> building and starting on the box"
ssh "${SSH_OPTS[@]}" "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build && docker compose ps"
