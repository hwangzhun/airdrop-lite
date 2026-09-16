#!/usr/bin/env bash
set -Eeuo pipefail

: "${TURN_SECRET:?TURN_SECRET must be set}"
: "${TURN_HOST:?TURN_HOST must be set to the public TURN hostname or IP}"

if [[ "${NODE_ENV:-production}" == "production" && ${#TURN_SECRET} -lt 24 ]]; then
  echo "TURN_SECRET must contain at least 24 characters in production" >&2
  exit 1
fi

turn_args=(
  -n
  --no-cli
  --fingerprint
  --lt-cred-mech
  --use-auth-secret
  "--static-auth-secret=${TURN_SECRET}"
  "--realm=${TURN_REALM:-${TURN_HOST}}"
  "--listening-port=${TURN_PORT:-3478}"
  "--min-port=${TURN_MIN_PORT:-49160}"
  "--max-port=${TURN_MAX_PORT:-49200}"
  --no-tls
  --no-dtls
  --no-multicast-peers
  --no-rfc5780
  --stale-nonce=600
  --log-file=stdout
  --simple-log
)

if [[ -n "${TURN_EXTERNAL_IP:-}" ]]; then
  turn_args+=("--external-ip=${TURN_EXTERNAL_IP}")
fi

node /app/dist-server/index.js &
app_pid=$!
turnserver "${turn_args[@]}" &
turn_pid=$!

shutdown() {
  trap - TERM INT EXIT
  kill -TERM "$app_pid" "$turn_pid" 2>/dev/null || true
  wait "$app_pid" "$turn_pid" 2>/dev/null || true
}

trap shutdown TERM INT EXIT
wait -n "$app_pid" "$turn_pid"
status=$?
shutdown
exit "$status"
