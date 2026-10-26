#!/bin/bash
# Usage: scripts/create-db-bucket.sh
# Creates the bucket that holds the Litestream replica of the database. Safe
# to run again: an existing bucket only gets its settings reapplied.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION DATABASE_BUCKET

if aws s3api head-bucket --bucket "$DATABASE_BUCKET" 2>/dev/null; then
  echo "s3://$DATABASE_BUCKET exists"
else
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$DATABASE_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$DATABASE_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  echo "created s3://$DATABASE_BUCKET in $AWS_REGION"
fi

aws s3api put-public-access-block --bucket "$DATABASE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Versioning stays off: Litestream keeps its own generations and snapshots,
# and versioning would only keep paying for the objects its retention deletes.
aws s3api put-bucket-lifecycle-configuration --bucket "$DATABASE_BUCKET" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "abort-incomplete-uploads",
        "Status": "Enabled",
        "Filter": { "Prefix": "" },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
      }
    ]
  }' >/dev/null

echo "s3://$DATABASE_BUCKET: public access blocked, incomplete uploads aborted after a day"
