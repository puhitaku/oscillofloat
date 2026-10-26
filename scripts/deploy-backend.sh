#!/bin/bash
# Usage: scripts/deploy-backend.sh
# Builds the backend, uploads it and restarts the service on the instance.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION

bucket="$(main_output DeployBucket)"
make -C "$ROOT" backend
aws s3 cp --no-progress "$ROOT/dist/oscillofloat" "s3://$bucket/oscillofloat"
run_on_instance /usr/local/bin/oscillofloat-update
