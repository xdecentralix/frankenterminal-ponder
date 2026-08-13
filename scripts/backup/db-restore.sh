#!/bin/bash
set -e

if [ -n "$DATABASE_URL" ]; then
  TARGET_DB="$DATABASE_URL"
  DUMP_FILE="${1:-}"
else
  TARGET_DB="${1:-}"
  DUMP_FILE="${2:-}"
fi

if [ -z "$TARGET_DB" ] || [ -z "$DUMP_FILE" ]; then
  echo "Usage: DATABASE_URL=postgresql://... ./scripts/backup/db-restore.sh <dump-file>"
  echo "   or: ./scripts/backup/db-restore.sh postgresql://... <dump-file>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DUMP_PATH="${SCRIPT_DIR}/${DUMP_FILE}"

if [ ! -f "$DUMP_PATH" ]; then
  echo "Error: dump file not found: scripts/backup/${DUMP_FILE}"
  exit 1
fi

echo "Restoring scripts/backup/${DUMP_FILE} to target database..."
echo "WARNING: This will overwrite existing data."
read -p "Proceed? [y/N] " confirm
if [ "$(echo "$confirm" | tr '[:upper:]' '[:lower:]')" != "y" ]; then
  echo "Aborted."
  exit 0
fi

# Remap localhost to host.docker.internal so pg_restore (inside a container) can reach the host
DOCKER_TARGET_DB="${TARGET_DB/localhost/host.docker.internal}"
DOCKER_TARGET_DB="${DOCKER_TARGET_DB/127.0.0.1/host.docker.internal}"

docker run --rm \
  -v "${SCRIPT_DIR}:/backup" \
  postgres:18.4 \
  pg_restore \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    -d "$DOCKER_TARGET_DB" \
    "/backup/${DUMP_FILE}"

echo "Done."
