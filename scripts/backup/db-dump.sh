#!/bin/bash
set -e

DATABASE_URL="${DATABASE_URL:-$1}"

if [ -z "$DATABASE_URL" ]; then
  echo "Usage: DATABASE_URL=postgresql://... ./scripts/db-dump.sh"
  echo "   or: ./scripts/db-dump.sh postgresql://..."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="backup_${TIMESTAMP}.dump"

echo "Dumping database to scripts/${FILENAME}..."
docker run --rm \
  -v "${SCRIPT_DIR}:/backup" \
  postgres:18.4 \
  pg_dump "$DATABASE_URL" -Fc -f "/backup/${FILENAME}"
echo "Done. ($(du -sh "${SCRIPT_DIR}/${FILENAME}" | cut -f1))"
