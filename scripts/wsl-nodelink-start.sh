#!/usr/bin/env bash
set -euo pipefail
export PATH="/mnt/c/Program Files/Git/cmd:/mnt/c/Program Files/Git/bin:${HOME}/.local/node/bin:${PATH}"

DEST="${HOME}/NodeLink"
ENV_FILE="/mnt/d/Projects/AloraMC/Erica/.env.dev"
NODELINK_ENV="/mnt/d/Projects/AloraMC/Erica/scripts/nodelink.env"

if [[ ! -d "$DEST" ]]; then
  echo "NodeLink not installed. Run scripts/wsl-nodelink-setup.sh first." >&2
  exit 1
fi

# Load the same NodeLink knobs as Compose (SABR clients, fallbacks, SC off, …)
if [[ -f "$NODELINK_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$NODELINK_ENV"
  set +a
else
  echo "Warning: $NODELINK_ENV missing — using minimal defaults." >&2
  export NODELINK_SERVER_HOST="${NODELINK_SERVER_HOST:-0.0.0.0}"
  export NODELINK_SERVER_PORT="${NODELINK_SERVER_PORT:-3000}"
  export NODELINK_SERVER_PASSWORD="${NODELINK_SERVER_PASSWORD:-youshallnotpass}"
  export NODELINK_CLUSTER_ENABLED="${NODELINK_CLUSTER_ENABLED:-false}"
  export NODELINK_LOGGING_LEVEL="${NODELINK_LOGGING_LEVEL:-info}"
  export NODELINK_SOURCES_SPOTIFY_ENABLED="${NODELINK_SOURCES_SPOTIFY_ENABLED:-true}"
  export NODELINK_SOURCES_YOUTUBE_CIPHER_URL="${NODELINK_SOURCES_YOUTUBE_CIPHER_URL:-https://cipher.kikkia.dev/api}"
fi

# Overlay Spotify creds + optional cipher token from Erica .env.dev (no echo)
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      SPOTIFY_CLIENT_ID=*)
        export NODELINK_SOURCES_SPOTIFY_CLIENTID="${line#SPOTIFY_CLIENT_ID=}"
        ;;
      SPOTIFY_CLIENT_SECRET=*)
        export NODELINK_SOURCES_SPOTIFY_CLIENTSECRET="${line#SPOTIFY_CLIENT_SECRET=}"
        ;;
      NODELINK_SOURCES_YOUTUBE_CIPHER_TOKEN=*)
        export NODELINK_SOURCES_YOUTUBE_CIPHER_TOKEN="${line#NODELINK_SOURCES_YOUTUBE_CIPHER_TOKEN=}"
        ;;
    esac
  done < "$ENV_FILE"
fi

cd "$DEST"
echo "Starting NodeLink on ${NODELINK_SERVER_HOST}:${NODELINK_SERVER_PORT}"
exec npm start
