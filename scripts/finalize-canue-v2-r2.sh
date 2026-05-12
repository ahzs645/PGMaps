#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/Volumes/Main/canue-pmtiles-bc-v2}"
PLAN="${PLAN:-docs/canue-map-layer-plan-bc.json}"
V1_OUTPUT_DIR="${V1_OUTPUT_DIR:-/Volumes/Main/canue-pmtiles-bc}"
R2_ENDPOINT="${R2_ENDPOINT:-https://479e77f49d4ac5d7498529ee360f194b.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-maps}"
R2_PREFIX="${R2_PREFIX:-canue/pmtiles-v2}"
AWS_PROFILE="${AWS_PROFILE:-r2}"

python3 scripts/build-canue-v2-app-catalog.py \
  --output-dir "$OUTPUT_DIR" \
  --plan "$PLAN" \
  --v1-output-dir "$V1_OUTPUT_DIR" \
  --view bc \
  --mode grid

python3 scripts/validate-canue-v2-catalog.py \
  --catalog "$OUTPUT_DIR/canue-bc-grid-v2-app-catalog.json" \
  --output-dir "$OUTPUT_DIR" \
  --inspect-tiles

aws s3 sync "$OUTPUT_DIR" "s3://${R2_BUCKET}/${R2_PREFIX}" \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --exclude "*" \
  --include "*.pmtiles" \
  --exclude "._*" \
  --exclude "*/._*" \
  --content-type "application/vnd.pmtiles" \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$OUTPUT_DIR/canue-bc-grid-v2-app-catalog.json" \
  "s3://${R2_BUCKET}/${R2_PREFIX}/canue-bc-grid-v2-app-catalog.json" \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" \
  --cache-control "public,max-age=300,must-revalidate"

aws s3 cp "$OUTPUT_DIR/canue-bc-grid-v2-metadata.json" \
  "s3://${R2_BUCKET}/${R2_PREFIX}/canue-bc-grid-v2-metadata.json" \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" \
  --cache-control "public,max-age=300,must-revalidate"

aws s3 cp "$OUTPUT_DIR/canue-bc-grid-v2-build-report.json" \
  "s3://${R2_BUCKET}/${R2_PREFIX}/canue-bc-grid-v2-build-report.json" \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" \
  --cache-control "public,max-age=300,must-revalidate"

aws s3 rm "s3://${R2_BUCKET}/${R2_PREFIX}" \
  --recursive \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --exclude "*" \
  --include "._*" \
  --include "*/._*"

curl -I "https://data.map.ahmad.sh/${R2_PREFIX}/canue-bc-grid-v2-app-catalog.json"
