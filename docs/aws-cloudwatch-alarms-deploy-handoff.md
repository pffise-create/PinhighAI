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

Steps:
1. Create the SNS topic and email subscription:
   aws sns create-topic --name golf-coach-alarms-prod --region us-east-1
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:<ACCOUNT_ID>:golf-coach-alarms-prod \
     --protocol email \
     --notification-endpoint pffise@gmail.com \
     --region us-east-1
   # Confirm the subscription email in pffise@gmail.com before continuing.

2. Deploy the alarm stack with per-Lambda p95 thresholds:
   aws cloudformation deploy \
     --stack-name golf-coach-cloudwatch-alarms \
     --template-file infrastructure/golf-cloudwatch-alarms.yaml \
     --parameter-overrides \
       ProjectName=golf-coach \
       Environment=prod \
       AlarmTopicArn=arn:aws:sns:us-east-1:<ACCOUNT_ID>:golf-coach-alarms-prod \
       ChatApiP95Ms=3000 \
       ResultsApiP95Ms=2000 \
       UploadP95Ms=10000 \
       FrameExtractorP95Ms=20000 \
       AiAnalysisP95Ms=45000 \
     --capabilities CAPABILITY_NAMED_IAM \
     --region us-east-1

3. Verify the stack and list every alarm provisioned:
   aws cloudformation describe-stacks \
     --stack-name golf-coach-cloudwatch-alarms \
     --query "Stacks[0].Outputs" --output table --region us-east-1
   aws cloudwatch describe-alarms \
     --alarm-name-prefix golf-coach-prod \
     --query "MetricAlarms[].{Name:AlarmName,State:StateValue}" \
     --output table --region us-east-1

4. Append the deploy result to docs/acceptance-evidence-2026-04-08.md under the
   "Operational readiness" section: stack ID, alarm names, alarm states, and
   timestamp. Commit on the same branch.

The template is already updated with the missing alarms and per-Lambda thresholds —
see infrastructure/golf-cloudwatch-alarms.yaml on
claude/backlog-orchestration-plan-bfVtG.
```

## Notes

- Replace `<ACCOUNT_ID>` with the AWS account number (e.g. `aws sts get-caller-identity --query Account --output text`).
- The template provisions **15 alarms** (5 Lambdas × Errors / Throttles / Duration p95). Defaults match the 4/7 PM decisions: chat=3s, results=2s, upload=10s, frame=20s, ai=45s; Errors≥1; Throttles≥1.
- Alarms deploy with **no notification target** if `AlarmTopicArn` is omitted — they'll still be visible in the CloudWatch console but no email/SMS will fire.
- Confirm the SNS email subscription before relying on alerts; unconfirmed subscriptions silently drop messages.
- The alarm `EvaluationPeriods` for duration is 3 minutes (1-min period × 3 evaluations) so transient spikes don't page; errors and throttles use 1 evaluation period and will fire on the first breach.
