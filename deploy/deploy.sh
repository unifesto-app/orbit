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

# Everything on the box runs in one SSH session that holds a lock (flock on ~/orbit/.deploy.lock), so two
# deploys at once can't wipe each other's source mid-build or swap the other's Caddyfile. A second deploy waits
# for the first, up to 15 minutes, then runs with its own copy. The lock is held by the deploy's process on the
# box, so it ends when that does; nothing stale is left behind. The compose file and Caddyfile come from the source's
# deploy/ folder.
# Caddy mounts the Caddyfile as one file, which keeps the old copy after a replace, so a changed Caddyfile is
# validated first and then picked up by restarting Caddy (a second's blip). Unchanged: no restart. The swap
# happens only after the build, so a failed build leaves the running Caddy as it was.
REMOTE=$(cat <<'REMOTE'
set -euo pipefail
cd "$1"
exec 9>.deploy.lock
if ! flock -n 9; then
  echo "==> another deploy is running on the box; waiting for it to finish (up to 15 minutes)"
  flock -w 900 9 || { echo "the other deploy is still running after 15 minutes; try again later" >&2; exit 1; }
fi
echo "==> syncing source"
rm -rf src && mkdir -p src && tar -C src -xzf -
cp src/deploy/docker-compose.yml docker-compose.yml
cp src/deploy/Caddyfile Caddyfile.new
echo "==> building and starting"
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
)

echo "==> deploying to $SERVER:$REMOTE_DIR"
# macOS tar packs Finder xattrs and file flags the box's GNU tar can't read; leave them out.
# The box builds api, web and galaxy only, so the app's generated native projects (hundreds of MB
# with Pods) and local tooling stay behind too. `^` anchors a pattern at the root; without it bsdtar
# would also drop, say, a web/src/app/docs route.
# The tar is the session's input; the script goes as an argument, so the two don't mix.
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --no-fflags -C "$ROOT" \
  --exclude=node_modules --exclude=.git --exclude='^./docs' --exclude='*.log' --exclude='.env*' \
  --exclude=.next --exclude=.expo --exclude=dist \
  --exclude='^./app/ios' --exclude='^./app/android' --exclude='^./.claude' --exclude=.DS_Store \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "$SERVER" "bash -c $(printf '%q' "$REMOTE") deploy $(printf '%q' "$REMOTE_DIR")"
