#!/usr/bin/env bash
# Validate that an automation exported here is accepted by REAL n8n, using
# n8n's own import:workflow loader (not our own checks).
#
# Prereq: real n8n installed somewhere (e.g. `npm install n8n` in a scratch dir,
# or `npm i -g n8n`). Pass the path to the n8n binary as $N8N_BIN, or have it on PATH.
#
# Usage:
#   N8N_BIN=/path/to/node_modules/.bin/n8n scripts/validate-with-n8n.sh export.json
set -euo pipefail

EXPORT_FILE="${1:?usage: validate-with-n8n.sh <exported-n8n-workflow.json>}"
N8N_BIN="${N8N_BIN:-n8n}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Using n8n: $("$N8N_BIN" --version 2>/dev/null | tail -1)"
echo "Importing '$EXPORT_FILE' via n8n's own loader..."
N8N_USER_FOLDER="$WORK" N8N_DIAGNOSTICS_ENABLED=false DB_SQLITE_POOL_SIZE=1 \
  "$N8N_BIN" import:workflow --input="$EXPORT_FILE" 2>&1 | grep -iE "Importing|Successfully|error" || true

echo "Re-exporting from n8n's DB (proves n8n fully parsed it)..."
N8N_USER_FOLDER="$WORK" N8N_DIAGNOSTICS_ENABLED=false DB_SQLITE_POOL_SIZE=1 \
  "$N8N_BIN" export:workflow --all --output="$WORK/reexport.json" 2>&1 | grep -iE "Successfully" || true
node -e 'const j=require(process.argv[1]); const w=Array.isArray(j)?j[0]:j; console.log("n8n stored:", w.nodes.length, "nodes,", Object.keys(w.connections).length, "connection sources");' "$WORK/reexport.json"
