#!/usr/bin/env bash
set -euo pipefail

: "${DEMO_PUBLIC_ORIGIN:?Set the HTTPS Worker origin (or http://localhost:3000 for local verification)}"
: "${REDE_SECURITY_ENCRYPTION_KEY:?Set a demo-only encryption key}"
mkdir -p /tmp/rede-db
if [[ -f /opt/render-demo/seed/accounts.tsv ]]; then
  rm -rf /tmp/demo-uploads /tmp/demo-media
  mkdir -m 0700 /tmp/demo-media
  cp -R /opt/render-demo/media/. /tmp/demo-media/
  export DEMO_MEDIA_WRITABLE=true
fi
cp /opt/render-demo/seed/rede.mv.db /tmp/rede-db/rede.mv.db
chmod 0600 /tmp/rede-db/rede.mv.db
rm -f /tmp/rede-db/rede.trace.db /tmp/rede-db/rede.lock.db
java -cp '/opt/render-demo/tools:/opt/render-demo/backend/lib/*' DemoCredentials

java \
  --enable-native-access=ALL-UNNAMED \
  -XX:ActiveProcessorCount=1 \
  -Xms48m -Xmx768m -Xss512k \
  -XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=32m \
  -XX:MaxDirectMemorySize=16m \
  -XX:+UseSerialGC \
  -jar /opt/render-demo/backend/rede.jar \
  --spring.profiles.active=demo \
  --server.address=127.0.0.1 \
  --server.port=8081 &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "${FRONTEND_PID:-}" "${GATEWAY_PID:-}" "${REGISTER_PID:-}" 2>/dev/null || true
  wait "$BACKEND_PID" "${FRONTEND_PID:-}" "${GATEWAY_PID:-}" "${REGISTER_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for attempt in $(seq 1 600); do
  if curl --fail --silent http://127.0.0.1:8081/api/actuator/health/readiness >/dev/null; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited before readiness" >&2
    exit 1
  fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8081/api/actuator/health/readiness >/dev/null

export HOST=0.0.0.0
export NITRO_HOST="$HOST"
export NITRO_PORT=3001
export BACKEND_TARGET=http://127.0.0.1:8081
PORT=3001 node --max-old-space-size=256 /opt/render-demo/frontend/server/index.mjs &
FRONTEND_PID=$!

node /opt/render-demo/gateway.mjs &
GATEWAY_PID=$!
if [[ "${CODESPACES:-false}" == true ]]; then
  node /opt/render-demo/register-codespace.mjs &
  REGISTER_PID=$!
fi

wait -n "$BACKEND_PID" "$FRONTEND_PID" "$GATEWAY_PID"
