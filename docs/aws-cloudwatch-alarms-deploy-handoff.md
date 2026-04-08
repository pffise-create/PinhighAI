# AWS CloudWatch Alarms Deploy Handoff

This is the self-contained prompt to run on a local machine where the `aws` CLI is configured with credentials for the Golf Coach AWS account. It deploys the CloudWatch alarm stack provisioned in `infrastructure/golf-cloudwatch-alarms.yaml` and records evidence on the launch branch.

## Why this exists

The remote agent session that prepared the launch backlog (branch `claude/backlog-orchestration-plan-bfVtG`) does not have AWS credentials. The template, deploy commands, and parameter overrides are all in the repo — only the actual `aws cloudformation deploy` call needs a credentialed environment.

## Prompt to paste into Claude Code locally

```text
Deploy the Golf Coach CloudWatch alarms stack and verify it.

Context:
- Repo branch: claude/backlog-orchestration-plan-bfVtG (already pushed to origin)
- Template: infrastructure/golf-cloudwatch-alarms.yaml
- Region: us-east-1
- Environment: prod
- Alert email: pffise@gmail.com (must confirm subscription from inbox after deploy)
- The template requires all 5 *FunctionName parameters — no defaults — so a
  typo or rename surfaces at deploy time instead of silently watching nothing.

Steps:
0. Capture the AWS account ID for the SNS topic ARN below:
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   echo "$ACCOUNT_ID"

1. Confirm the actual Lambda names match what we expect (typo guard):
   aws lambda list-functions \
     --query "Functions[?starts_with(FunctionName, 'golf-')].FunctionName" \
     --output table --region us-east-1
   # Expected: golf-video-upload-handler, golf-frame-extractor-simple,
   #           golf-ai-analysis-processor, golf-results-api-handler,
   #           golf-chat-api-handler. If any differ, update the
   #           --parameter-overrides values in step 3 before deploying.

2. Create the SNS topic and email subscription:
   aws sns create-topic --name golf-coach-alarms-prod --region us-east-1
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:${ACCOUNT_ID}:golf-coach-alarms-prod \
     --protocol email \
     --notification-endpoint pffise@gmail.com \
     --region us-east-1
   # Confirm the subscription email in pffise@gmail.com before continuing.

3. Deploy the alarm stack with all required parameters:
   aws cloudformation deploy \
     --stack-name golf-coach-cloudwatch-alarms \
     --template-file infrastructure/golf-cloudwatch-alarms.yaml \
     --parameter-overrides \
       ProjectName=golf-coach \
       Environment=prod \
       AlarmTopicArn=arn:aws:sns:us-east-1:${ACCOUNT_ID}:golf-coach-alarms-prod \
       UploadHandlerFunctionName=golf-video-upload-handler \
       FrameExtractorFunctionName=golf-frame-extractor-simple \
       AiAnalysisFunctionName=golf-ai-analysis-processor \
       ResultsApiFunctionName=golf-results-api-handler \
       ChatApiFunctionName=golf-chat-api-handler \
       ChatApiP95Ms=3000 \
       ResultsApiP95Ms=2000 \
       UploadP95Ms=10000 \
       FrameExtractorP95Ms=20000 \
       AiAnalysisP95Ms=45000 \
     --capabilities CAPABILITY_NAMED_IAM \
     --region us-east-1

4. Verify the stack and list every alarm provisioned:
   aws cloudformation describe-stacks \
     --stack-name golf-coach-cloudwatch-alarms \
     --query "Stacks[0].Outputs" --output table --region us-east-1
   aws cloudwatch describe-alarms \
     --alarm-name-prefix golf-coach-prod \
     --query "MetricAlarms[].{Name:AlarmName,State:StateValue}" \
     --output table --region us-east-1

5. Append the deploy result to docs/acceptance-evidence-2026-04-08.md under the
   "Operational readiness" section: stack ID, alarm names, alarm states, and
   timestamp. Commit on the same branch.

The template is already updated with the missing alarms and per-Lambda thresholds —
see infrastructure/golf-cloudwatch-alarms.yaml on
claude/backlog-orchestration-plan-bfVtG.
```

## Notes

- The 5 `*FunctionName` parameters are **required** — there are no defaults. Confirm them with `aws lambda list-functions` before deploying.
- The template provisions **15 alarms** (5 Lambdas × Errors / Throttles / Duration p95). Default thresholds match the 4/7 PM decisions: chat=3s, results=2s, upload=10s, frame=20s, ai=45s; Errors≥1; Throttles≥1.
- Alarms deploy with **no notification target** if `AlarmTopicArn` is omitted — they'll still be visible in the CloudWatch console but no email/SMS will fire.
- Confirm the SNS email subscription before relying on alerts; unconfirmed subscriptions silently drop messages.
- The alarm `EvaluationPeriods` for duration is 3 minutes (1-min period × 3 evaluations) so transient spikes don't page; errors and throttles use 1 evaluation period and will fire on the first breach.
- **Blind spot:** alarms use `TreatMissingData: notBreaching`, so a fully dead Lambda (zero invocations) will not page. If you need a dead-Lambda heartbeat, layer in an API Gateway 5xx alarm or a synthetic ping.
