#!/usr/bin/env bash
#
# Database backup/restore script for local Docker PostgreSQL.
#
# Usage:
#   scripts/db-backup.sh              # create a backup
#   scripts/db-backup.sh restore <file>  # restore from a backup
#   scripts/db-backup.sh list         # list available backups
#   scripts/db-backup.sh prune [days] # delete backups older than N days (default: 14)
#
set -euo pipefail

BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml"
DB_NAME="parental_sanity"
DB_USER="postgres"
CONTAINER_SERVICE="postgres"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

backup() {
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local filename="backup_${timestamp}.dump"
  local filepath="${BACKUP_DIR}/${filename}"

  echo "Backing up ${DB_NAME}..."
  docker compose -f "$COMPOSE_FILE" exec -T "$CONTAINER_SERVICE" \
    pg_dump -U "$DB_USER" -Fc --no-owner "$DB_NAME" > "$filepath"

  local size
  size=$(du -h "$filepath" | cut -f1)
  echo "Backup saved: ${filepath} (${size})"
}

restore() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    # Check if it's a filename in the backup dir
    if [ -f "${BACKUP_DIR}/${filepath}" ]; then
      filepath="${BACKUP_DIR}/${filepath}"
    else
      echo "Error: file not found: ${filepath}"
      exit 1
    fi
  fi

  echo "WARNING: This will overwrite the current ${DB_NAME} database."
  echo "File: ${filepath}"
  read -rp "Continue? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi

  echo "Restoring ${DB_NAME} from ${filepath}..."

  # Terminate existing connections so pg_restore --clean can drop objects
  docker compose -f "$COMPOSE_FILE" exec -T "$CONTAINER_SERVICE" \
    psql -U "$DB_USER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    > /dev/null 2>&1 || true

  docker compose -f "$COMPOSE_FILE" exec -T "$CONTAINER_SERVICE" \
    pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --no-owner --if-exists < "$filepath"

  echo "Restore complete."
}

list_backups() {
  if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    echo "No backups found in ${BACKUP_DIR}"
    return
  fi

  echo "Available backups:"
  echo ""
  ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null | awk '{print $NF, $5}' | while read -r path size; do
    echo "  $(basename "$path")  ${size}"
  done
}

prune() {
  local days="${1:-$RETENTION_DAYS}"
  local count
  count=$(find "$BACKUP_DIR" -name "*.dump" -mtime +"$days" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$count" -eq 0 ]; then
    echo "No backups older than ${days} days."
    return
  fi

  echo "Deleting ${count} backup(s) older than ${days} days..."
  find "$BACKUP_DIR" -name "*.dump" -mtime +"$days" -print -delete
  echo "Done."
}

case "${1:-backup}" in
  backup)
    backup
    ;;
  restore)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 restore <backup-file>"
      exit 1
    fi
    restore "$2"
    ;;
  list)
    list_backups
    ;;
  prune)
    prune "${2:-}"
    ;;
  *)
    echo "Usage: $0 [backup|restore <file>|list|prune [days]]"
    exit 1
    ;;
esac
