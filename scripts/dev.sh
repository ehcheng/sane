#!/bin/bash
# Start both web and worker processes for local development.
# Debug/logging settings are configured via Admin > Settings (stored in DB).
#
# Usage:
#   ./scripts/dev.sh          # start both processes
#   ./scripts/dev.sh stop     # stop both processes

set -e
cd "$(dirname "$0")/.."

# Source .env for secrets (strip quotes, skip comments/blanks)
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    # skip comments and blank lines
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # strip surrounding quotes
    value="${value%\"}"
    value="${value#\"}"
    export "$key=$value"
  done < .env
fi

# Handle stop command
if [ "$1" = "stop" ]; then
  echo "Stopping dev processes..."
  pkill -f 'next dev' 2>/dev/null || true
  pkill -f 'tsx.*worker.*index' 2>/dev/null || true
  pkill -f 'dotenv.*tsx.*watch.*worker' 2>/dev/null || true
  echo "Stopped."
  exit 0
fi

# Stop any existing processes first
pkill -f 'next dev' 2>/dev/null || true
pkill -f 'tsx.*worker.*index' 2>/dev/null || true
pkill -f 'dotenv.*tsx.*watch.*worker' 2>/dev/null || true
sleep 1

# Always log to files for dev convenience
LOG_DIR="${LOG_DIR:-logs}"
mkdir -p "$LOG_DIR"

NEXT_LOG="$LOG_DIR/next.log"
WORKER_LOG="$LOG_DIR/worker.log"

echo "Logging to $LOG_DIR/"
echo "  Web:    $NEXT_LOG"
echo "  Worker: $WORKER_LOG"
echo ""

npm run dev >> "$NEXT_LOG" 2>&1 &
WEB_PID=$!

npm run worker:dev >> "$WORKER_LOG" 2>&1 &
WORKER_PID=$!

echo "Started web (PID $WEB_PID) and worker (PID $WORKER_PID)"
echo "Tailing logs... (Ctrl+C to stop tailing; processes keep running)"
echo "Run './scripts/dev.sh stop' to stop both processes."
echo ""
tail -f "$NEXT_LOG" "$WORKER_LOG"
