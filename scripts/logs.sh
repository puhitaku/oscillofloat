#!/bin/bash
# Usage: scripts/logs.sh [LINES]
# Prints the last LINES (default 200) lines of the service's journal.
set -euo pipefail
lines="${1:-200}"
case "$lines" in
  '' | *[!0-9]*)
    echo "usage: $0 [LINES]" >&2
    exit 2
    ;;
esac
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require AWS_REGION

instance_id="$(main_output InstanceId)"
run_on_instance "journalctl -u oscillofloat --no-pager -n $lines"
echo >&2
echo "SSM keeps only the first 24000 characters; for more, open a shell:" >&2
echo "  aws ssm start-session --region $AWS_REGION --target $instance_id" >&2
