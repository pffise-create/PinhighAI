#!/bin/bash

# Toggle the CHAT_LOOP_ENABLED environment variable for the chat Lambda.

set -euo pipefail

FUNCTION_NAME="golf-chat-api-handler"
REGION="us-east-1"
VALUE="true"

usage() {
  cat <<EOF
Usage: $(basename "$0") [-f function_name] [-r region] [-v value]
  -f    Lambda function name (default: $FUNCTION_NAME)
  -r    AWS region (default: $REGION)
  -v    Value for CHAT_LOOP_ENABLED (default: true)
  -h    Show this help message

Example:
  ./set-chat-loop-flag.sh -f golf-chat-api-handler -r us-east-1 -v true
EOF
}

while getopts "f:r:v:h" opt; do
  case $opt in
    f) FUNCTION_NAME="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    v) VALUE="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run this script." >&2
  exit 1
fi

if ! command -v cygpath >/dev/null 2>&1; then
  echo "cygpath is required (bundled with Git Bash)." >&2
  exit 1
fi

TMP_VARS=$(mktemp)
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_VARS" "$TMP_ENV"' EXIT

TMP_ENV_WIN=$(cygpath -w "$TMP_ENV")

aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json > "$TMP_VARS"

node - <<'NODE' "$TMP_VARS" "$VALUE" "$TMP_ENV"
const fs = require('fs');
const [varsPath, value, outPath] = process.argv.slice(2);
let existing = {};
try {
  const raw = fs.readFileSync(varsPath, 'utf8').trim();
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed;
    }
  }
} catch (error) {
  existing = {};
}
existing.CHAT_LOOP_ENABLED = value;
fs.writeFileSync(outPath, JSON.stringify({ Variables: existing }), 'utf8');
NODE

UPDATED_VALUE=$(aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --environment "file://$TMP_ENV_WIN" \
  --query 'Environment.Variables.CHAT_LOOP_ENABLED' \
  --output text)

echo "CHAT_LOOP_ENABLED set to $UPDATED_VALUE for $FUNCTION_NAME in $REGION"
