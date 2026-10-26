# shellcheck shell=bash
# Sourced by the other scripts: loads deploy.env and defines helpers.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() {
  echo "error: $*" >&2
  exit 1
}

if [ ! -f "$ROOT/deploy.env" ]; then
  die "$ROOT/deploy.env not found; copy deploy.env.example and fill it in"
fi
set -a
# shellcheck source=/dev/null
. "$ROOT/deploy.env"
set +a

STACK_NAME="${STACK_NAME:-oscillofloat}"
CERT_STACK_NAME="${CERT_STACK_NAME:-oscillofloat-cert}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.nano}"

# An empty AWS_PROFILE makes the CLI look for a profile named "".
if [ -z "${AWS_PROFILE:-}" ]; then
  unset AWS_PROFILE
fi
if [ -n "${AWS_REGION:-}" ]; then
  export AWS_DEFAULT_REGION="$AWS_REGION"
fi
export AWS_PAGER=""

# require KEY... fails unless every key is set in deploy.env.
require() {
  local key missing=()
  for key in "$@"; do
    if [ -z "${!key:-}" ]; then
      missing+=("$key")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die "set ${missing[*]} in $ROOT/deploy.env"
  fi
}

# stack_output STACK REGION KEY prints one output of a deployed stack.
stack_output() {
  local value
  value="$(aws cloudformation describe-stacks --region "$2" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$3'].OutputValue" --output text)"
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    die "stack $1 in $2 has no output $3"
  fi
  printf '%s\n' "$value"
}

main_output() {
  stack_output "$STACK_NAME" "$AWS_REGION" "$1"
}

# run_on_instance COMMAND runs a shell command on the instance through SSM,
# waits for it, prints its output and fails when the command failed.
run_on_instance() {
  local instance_id command_id status params
  instance_id="$(main_output InstanceId)" || exit 1
  if [ "$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$instance_id" \
    --query 'length(InstanceInformationList)' --output text)" = "0" ]; then
    die "$instance_id is not registered with SSM yet; wait a few minutes after the stack is deployed"
  fi
  params="$(printf '{"commands":["%s"]}' "$1")"
  command_id="$(aws ssm send-command \
    --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --comment "oscillofloat scripts" \
    --parameters "$params" \
    --query Command.CommandId --output text)"
  # Not left to set -e: the waiter also fails when the command failed, and
  # the output is most useful exactly then.
  aws ssm wait command-executed --command-id "$command_id" --instance-id "$instance_id" || true
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query StandardOutputContent --output text
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text >&2
  status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query Status --output text)"
  if [ "$status" != "Success" ]; then
    die "command on $instance_id ended with status $status"
  fi
}
