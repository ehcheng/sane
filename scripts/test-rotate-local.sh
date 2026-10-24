#!/bin/bash
# Local round-trip test for rotate-encryption-key.ts. Uses .env (local DB only).
# Rotates local data to a throwaway key, then back to your .env key.
set -e
set -a; source .env; set +a
case "$DATABASE_URL" in *localhost*|*127.0.0.1*) ;; *) echo "Refusing: DATABASE_URL is not local"; exit 1;; esac

# Restorable with: scripts/db-backup.sh restore <file>
scripts/db-backup.sh

LOCAL_KEY="$ENCRYPTION_KEY"
TEMP_KEY=$(openssl rand -hex 32)
run() { OLD_ENCRYPTION_KEY="$1" NEW_ENCRYPTION_KEY="$2" npx tsx scripts/rotate-encryption-key.ts $3; }

echo; echo "== 1. dry run";                     run "$LOCAL_KEY" "$TEMP_KEY"
echo; echo "== 2. apply";                       run "$LOCAL_KEY" "$TEMP_KEY" --apply
echo; echo "== 3. re-run, expect rotated=0";    run "$LOCAL_KEY" "$TEMP_KEY"
echo; echo "== 4. wrong key, expect FAILED";    run "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" || true
echo; echo "== 5. rotate back to .env key";     run "$TEMP_KEY" "$LOCAL_KEY" --apply
echo; echo "== 6. confirm, expect rotated=0";   run "$TEMP_KEY" "$LOCAL_KEY"
