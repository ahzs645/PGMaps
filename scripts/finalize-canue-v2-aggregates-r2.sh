#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/Volumes/Main/canue-aggregates-v2}"
R2_ENDPOINT="${R2_ENDPOINT:-https://479e77f49d4ac5d7498529ee360f194b.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-maps}"
R2_PREFIX="${R2_PREFIX:-canue/aggregates-v2}"
AWS_PROFILE="${AWS_PROFILE:-r2}"

aws s3 sync "$OUTPUT_DIR" "s3://${R2_BUCKET}/${R2_PREFIX}" \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --exclude "*" \
  --include "*.json" \
  --exclude "._*" \
  --exclude "*/._*" \
  --content-type "application/json" \
  --cache-control "public,max-age=300,must-revalidate"

aws s3 rm "s3://${R2_BUCKET}/${R2_PREFIX}" \
  --recursive \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --exclude "*" \
  --include "._*" \
  --include "*/._*"

curl -I "https://data.map.ahmad.sh/${R2_PREFIX}/canue-bc-aggregates-v2-catalog.json"
