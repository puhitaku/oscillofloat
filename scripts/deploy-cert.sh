#!/bin/bash
# Usage: scripts/deploy-cert.sh
# Deploys infra/cert.yaml in us-east-1 and prints the certificate ARN.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require DOMAIN_NAME HOSTED_ZONE_ID

# us-east-1 regardless of AWS_REGION: CloudFront only takes certificates from there.
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name "$CERT_STACK_NAME" \
  --template-file "$ROOT/infra/cert.yaml" \
  --parameter-overrides "DomainName=$DOMAIN_NAME" "HostedZoneId=$HOSTED_ZONE_ID" \
  --no-fail-on-empty-changeset

stack_output "$CERT_STACK_NAME" us-east-1 CertificateArn
