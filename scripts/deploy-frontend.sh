#!/bin/bash
# Usage: scripts/deploy-frontend.sh
# Builds the frontend, uploads it and invalidates the CloudFront cache.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION

bucket="$(main_output FrontendBucket)"
distribution_id="$(main_output DistributionId)"

cd "$ROOT/frontend"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

# Assets first and stale ones last, so a page loaded during the upload
# never points at a file that is not there yet or no longer there.
aws s3 sync --no-progress dist/assets "s3://$bucket/assets" \
  --cache-control "public, max-age=31536000, immutable"
aws s3 sync --no-progress dist "s3://$bucket" --delete --exclude 'assets/*' \
  --cache-control "no-cache"
aws s3 sync --no-progress dist/assets "s3://$bucket/assets" --delete \
  --cache-control "public, max-age=31536000, immutable"

invalidation_id="$(aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" --paths '/*' \
  --query Invalidation.Id --output text)"
echo "waiting for invalidation $invalidation_id"
aws cloudfront wait invalidation-completed --distribution-id "$distribution_id" --id "$invalidation_id"
echo "deployed to s3://$bucket"
