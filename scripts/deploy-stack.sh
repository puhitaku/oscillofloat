#!/bin/bash
# Usage: scripts/deploy-stack.sh
# Deploys infra/stack.yaml in AWS_REGION and prints its outputs.
# USER_POOL_DELETION_PROTECTION=INACTIVE in the environment lifts the user
# pool's deletion protection; only do that right before deleting the stack.
set -euo pipefail
deletion_protection="${USER_POOL_DELETION_PROTECTION:-ACTIVE}"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION DOMAIN_NAME DATABASE_BUCKET

prefix_list_id="$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)"
if [ -z "$prefix_list_id" ] || [ "$prefix_list_id" = "None" ]; then
  die "no CloudFront origin-facing prefix list in $AWS_REGION"
fi
certificate_arn="$(stack_output "$CERT_STACK_NAME" us-east-1 CertificateArn)"

params=(
  "DomainName=$DOMAIN_NAME"
  "CertificateArn=$certificate_arn"
  "DatabaseBucketName=$DATABASE_BUCKET"
  "InstanceType=$INSTANCE_TYPE"
  "CloudFrontOriginFacingPrefixListId=$prefix_list_id"
  "UserPoolDeletionProtection=$deletion_protection"
)
if [ -n "${UPLOAD_RATE:-}" ]; then
  params+=("UploadRate=$UPLOAD_RATE")
fi
if [ -n "${LITESTREAM_VERSION:-}" ]; then
  params+=("LitestreamVersion=$LITESTREAM_VERSION")
fi

# The AMI parameter resolves to the newest Amazon Linux on every deployment,
# and a new image replaces the instance. Warn rather than pin it: the data is
# in the replica and the binary in the deploy bucket, so replacement is safe.
if instance_id="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text 2>/dev/null)" \
  && [ -n "$instance_id" ] && [ "$instance_id" != "None" ]; then
  current_ami="$(aws ec2 describe-instances --instance-ids "$instance_id" \
    --query 'Reservations[0].Instances[0].ImageId' --output text)"
  latest_ami="$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query Parameter.Value --output text)"
  if [ "$current_ami" != "$latest_ami" ]; then
    echo "note: $current_ami -> $latest_ami; this deployment replaces the instance" >&2
  fi
fi

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$ROOT/infra/stack.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "${params[@]}" \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
