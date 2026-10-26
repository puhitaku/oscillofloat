#!/bin/bash
# Usage: scripts/create-admin.sh EMAIL
# Creates an operator in the user pool. Cognito generates the temporary
# password and mails it with the sign-in instructions. Not idempotent: a
# second run for the same address fails with UsernameExistsException.
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "usage: $0 EMAIL" >&2
  exit 2
fi
email="$1"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION

user_pool_id="$(main_output UserPoolId)"
aws cognito-idp admin-create-user \
  --user-pool-id "$user_pool_id" \
  --username "$email" \
  --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" \
  --desired-delivery-mediums EMAIL \
  --query 'User.[Username,UserStatus]' --output text
echo "invitation sent to $email"
