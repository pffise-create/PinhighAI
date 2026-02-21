#!/bin/bash

# Golf Coach Swing Profile DynamoDB Deployment Script
# Provisions the `${ProjectName}-${Environment}` swing profile table used by the chat loop and AI analysis processor.

set -euo pipefail

STACK_NAME_BASE="golf-coach-swing-profiles"
STACK_NAME="$STACK_NAME_BASE"
PROJECT_NAME="golf-coach"
ENVIRONMENT="prod"
REGION="us-east-1"
TEMPLATE_FILE="golf-dynamo-tables.yaml"

log() {
  printf '%s\n' "[INFO] $1"
}

warn() {
  printf '%s\n' "[WARN] $1"
}

error() {
  printf '%s\n' "[ERROR] $1" >&2
}

require_aws() {
  if ! command -v aws >/dev/null 2>&1; then
    error "AWS CLI is not installed."
    exit 1
  fi

  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    error "AWS CLI is not configured. Run 'aws configure' before executing this script."
    exit 1
  fi
}

validate_template() {
  log "Validating CloudFormation template..."
  aws cloudformation validate-template \
    --template-body file://"$TEMPLATE_FILE" \
    >/dev/null
  log "Template validation succeeded."
}

resolve_stack_name() {
  local desired="$STACK_NAME_BASE-$ENVIRONMENT"
  local legacy="$STACK_NAME_BASE"

  if aws cloudformation describe-stacks --stack-name "$desired" --region "$REGION" >/dev/null 2>&1; then
    STACK_NAME="$desired"
    return
  fi

  if aws cloudformation describe-stacks --stack-name "$legacy" --region "$REGION" >/dev/null 2>&1; then
    local legacy_env
    legacy_env=$(aws cloudformation describe-stacks \
      --stack-name "$legacy" \
      --region "$REGION" \
      --query "Stacks[0].Parameters[?ParameterKey=='Environment'].ParameterValue" \
      --output text 2>/dev/null || true)

    if [[ "$legacy_env" == "$ENVIRONMENT" ]]; then
      warn "Reusing legacy stack name $legacy for environment $ENVIRONMENT"
      STACK_NAME="$legacy"
      return
    fi
  fi

  STACK_NAME="$desired"
}

stack_exists() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" >/dev/null 2>&1
}

create_or_update_stack() {
  local action="create-stack"
  local wait_command="stack-create-complete"

  if stack_exists; then
    warn "Stack $STACK_NAME already exists. Updating..."
    action="update-stack"
    wait_command="stack-update-complete"
  else
    log "Creating stack $STACK_NAME..."
  fi

  if ! aws cloudformation "$action" \
      --stack-name "$STACK_NAME" \
      --template-body file://"$TEMPLATE_FILE" \
      --parameters \
        ParameterKey=ProjectName,ParameterValue="$PROJECT_NAME" \
        ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
      --region "$REGION" >/dev/null; then
    if [[ "$action" == "update-stack" ]]; then
      warn "No updates to apply."
      return
    fi
    error "CloudFormation $action failed."
    exit 1
  fi

  log "Waiting for CloudFormation $wait_command ..."
  aws cloudformation wait "$wait_command" \
    --stack-name "$STACK_NAME" \
    --region "$REGION"
  log "Stack $STACK_NAME is ready."
}

print_outputs() {
  log "Retrieving stack outputs..."
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [-p project_name] [-e environment] [-r region]
  -p    Project name (default: $PROJECT_NAME)
  -e    Environment (dev|staging|prod) (default: $ENVIRONMENT)
  -r    AWS region (default: $REGION)

Creates or updates the CloudFormation stack ${STACK_NAME_BASE}-<env> (or the legacy stack when already provisioned).
EOF
}

while getopts "p:e:r:h" opt; do
  case $opt in
    p) PROJECT_NAME="$OPTARG" ;;
    e) ENVIRONMENT="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

resolve_stack_name

main() {
  log "Deploying DynamoDB swing profile table"
  log "Stack: $STACK_NAME | Project: $PROJECT_NAME | Env: $ENVIRONMENT | Region: $REGION"

  require_aws
  validate_template
  create_or_update_stack
  print_outputs

  log "Deployment complete. Remember to update Lambda environment variables or IAM policies if required."
}

main "$@"
