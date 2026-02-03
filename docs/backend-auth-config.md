# Backend Authentication & Timeout Configuration

These Lambda handlers now enforce verified Cognito JWTs and explicit HTTPS timeouts. Configure the environment before deploying to staging or production.

## Required Environment Variables

Set the following on `golf-video-upload-handler` and `golf-chat-api-handler` (and any other caller that verifies JWTs):

- `COGNITO_REGION` � e.g. `us-east-1`
- `COGNITO_USER_POOL_ID` � Cognito user pool that issues the ID tokens
- `COGNITO_APP_CLIENT_ID` � (Recommended) the app client audience that should be accepted

Optional tuning knobs that default to safe values:

- `HTTP_REQUEST_TIMEOUT_MS` � overall HTTPS timeout for OpenAI calls (chat + AI analysis)
- `JWKS_REQUEST_TIMEOUT_MS` � JWKS fetch timeout when present (defaults to 5s)

Without these variables the Lambdas will reject requests with 401-style fallbacks.

## Deployment Checklist

1. Update the Lambda configuration: `aws lambda update-function-configuration --function-name <name> --environment Variables="{...}"`.
2. Redeploy code packages (`aws lambda update-function-code ...`).
3. Run an end-to-end smoke test: authenticate, upload a swing, fetch results, and chat.
4. Watch CloudWatch logs for `JWT VERIFICATION ERROR` or timeout messages.

## Monitoring

- CloudWatch metrics: `Errors`, `Duration`, and `Throttles` for all three functions.
- Log search terms: `JWT VERIFICATION ERROR`, `Request to <host> timed out`, `Frame extraction data missing`.

Add automated integration tests as time allows to post signed Cognito tokens through API Gateway and assert success.

## Feature Flags

- `CHAT_LOOP_ENABLED`: When `true`, `/api/chat` uses the swing-aware chat loop with tool calls; when omitted or `false`, the legacy OpenAI thread flow is used.
- `CHAT_LOOP_MODEL` (optional): Overrides the OpenAI model used for chat completions (defaults to `gpt-4o-mini`).
- `CHAT_LOOP_MAX_TOOL_RUNS` (optional): Cap on iterative tool executions (defaults to `4`).\r\n### Manual Regression Checklist\r\n\r\n1. Upload a new swing via the mobile app; confirm the analysis completes and the final response references recent improvements/regressions.\r\n2. Repeat with CHAT_LOOP_ENABLED=true and ask the coach 'Was I OTT last swing?'; expect a numeric/path answer without frame/batch references.\r\n3. Re-run with CHAT_LOOP_ENABLED=false to confirm legacy chat still works.\r\n4. Monitor Lambda logs for 'Developer context' and confirm only one GSI query for recent swings.\r\n### Enabling the chat loop in lower environments

Use the helper script to toggle the feature flag on the deployed Lambda without overwriting other environment variables:

```bash
cd AWS/scripts
./set-chat-loop-flag.sh -f golf-chat-api-handler -r us-east-1 -v true   # enable
./set-chat-loop-flag.sh -f golf-chat-api-handler -r us-east-1 -v false  # disable
```

The script fetches the current `Environment.Variables`, updates only `CHAT_LOOP_ENABLED`, and reapplies the configuration. Run it for each environment (e.g. `-r us-east-1` with the appropriate AWS profile) after deploying the swing profile table so the chat loop can hydrate golfer state.
