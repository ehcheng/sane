#!/bin/bash
# Prompts for prod DB URL and both keys (hidden, kept out of shell history),
# then runs rotate-encryption-key.ts. Pass --apply to write; default is dry run.
# With --apply, dumps prod to backups/ first (gitignored; delete once verified,
# it holds PII readable with the leaked old key).
set -e
read -rsp "Prod DATABASE_URL: " DATABASE_URL; echo
read -rsp "OLD_ENCRYPTION_KEY: " OLD_ENCRYPTION_KEY; echo
read -rsp "NEW_ENCRYPTION_KEY: " NEW_ENCRYPTION_KEY; echo
export DATABASE_URL OLD_ENCRYPTION_KEY NEW_ENCRYPTION_KEY

if [ "$1" = "--apply" ]; then
  dump="backups/prod-pre-rotate-$(date +%Y%m%d_%H%M%S).dump"
  # libpq rejects Prisma's ?schema= param, so strip the query string
  pg_dump -Fc --no-owner "${DATABASE_URL%%\?*}" > "$dump"
  echo "Prod backup: $dump"
fi

npx tsx scripts/rotate-encryption-key.ts "$@"
