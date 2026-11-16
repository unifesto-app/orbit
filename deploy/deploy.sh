#!/usr/bin/env bash
set -euo pipefail

# Copies this repo to orbit-server and builds + starts Orbit's containers (and its Caddy) there.
# Nothing goes through a registry.
#   ./deploy/deploy.sh
#
# Needs on the server, in ~/orbit: the env files (api.env, web.env, galaxy.env) and certs/ (origin.pem,
# origin.key: the Cloudflare origin cert for heyorbit.in). Port 22 is closed: SSH goes through AWS Session
# Manager with the `orbit` profile (`aws login --profile orbit`) and the key ~/.ssh/orbit-key.

SERVER="${SERVER:-ubuntu@i-0ed25dbc7842ed78e}"
KEY="${KEY:-$HOME/.ssh/orbit-key}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/orbit}"
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=30
  -o "ProxyCommand=aws ssm start-session --profile ${AWS_PROFILE:-orbit} --region ap-south-1 --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p")

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The tar flags below are macOS (bsdtar) ones; stop here rather than after wiping the box's copy.
[[ "$(uname)" == Darwin ]] || { echo "deploy.sh runs from macOS (it uses bsdtar flags)" >&2; exit 1; }

echo "==> syncing source to $SERVER:$REMOTE_DIR/src"
# macOS tar packs Finder xattrs and file flags the box's GNU tar can't read; leave them out.
# The box builds api, web and galaxy only, so the app's generated native projects (hundreds of MB
# with Pods) and local tooling stay behind too. `^` anchors a pattern at the root; without it bsdtar
# would also drop, say, a web/src/app/docs route.
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --no-fflags -C "$ROOT" \
  --exclude=node_modules --exclude=.git --exclude='^./docs' --exclude='*.log' --exclude='.env*' \
  --exclude=.next --exclude=.expo --exclude=dist \
  --exclude='^./app/ios' --exclude='^./app/android' --exclude='^./.claude' --exclude=.DS_Store \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "$SERVER" "rm -rf $REMOTE_DIR/src && mkdir -p $REMOTE_DIR/src && tar -C $REMOTE_DIR/src -xzf -"

echo "==> copying compose file and Caddyfile"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/docker-compose.yml" "$SERVER:$REMOTE_DIR/docker-compose.yml"
scp "${SSH_OPTS[@]}" "$ROOT/deploy/Caddyfile" "$SERVER:$REMOTE_DIR/Caddyfile.new"

echo "==> building and starting on the box"
# Caddy mounts the Caddyfile as one file, which keeps the old copy after a replace, so a changed
# Caddyfile is validated first and then picked up by restarting Caddy (a second's blip). Unchanged: no restart.
# The swap happens only after the build, so a failed deploy leaves Caddyfile.new to be swapped next time.
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
cd "$1"
changed=0
if ! cmp -s Caddyfile.new Caddyfile 2>/dev/null; then
  [ -f certs/origin.pem ] && [ -f certs/origin.key ] || { echo "certs/origin.pem and origin.key are missing" >&2; exit 1; }
  docker run --rm -v "$PWD/Caddyfile.new:/etc/caddy/Caddyfile:ro" -v "$PWD/certs:/etc/caddy/certs:ro" \
    caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  [ -f Caddyfile ] || cp Caddyfile.new Caddyfile   # first deploy: a real file, not a directory, at the mount path
  changed=1
fi
docker compose up -d --build
if [ "$changed" = 1 ]; then mv Caddyfile.new Caddyfile; docker compose restart caddy; else rm Caddyfile.new; fi
docker compose ps
REMOTE
