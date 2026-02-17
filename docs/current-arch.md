# Current AWS Backend Architecture

## Lambda Functions
| Function | Purpose | Triggers & Inputs | Key Env / Dependencies | Source |
| --- | --- | --- | --- | --- |
| `golf-video-upload-handler` | Seeds a swing-analysis job, validates JWT, and kicks off downstream processing. | API Gateway `POST /api/video/analyze` body `{ s3Key, bucketName }`; optional Cognito bearer token for authenticated users. | `DYNAMODB_TABLE`, `FRAME_EXTRACTOR_FUNCTION_NAME` (defaults to `golf-coach-frame-extractor-simple`), `AI_ANALYSIS_PROCESSOR_FUNCTION_NAME`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `JWKS_REQUEST_TIMEOUT_MS` / `HTTP_REQUEST_TIMEOUT_MS`. | `AWS/src/api-handlers/video-upload-handler.js:381` |
| `golf-frame-extractor-simple` | Downloads swing video, extracts frames via ffmpeg layer, stores frame metadata, and notifies the AI processor. | Async `Invoke` from video upload Lambda; also accepts direct `ObjectCreated` S3 events (`Records[0].s3.*`). | `DYNAMODB_TABLE` (default `golf-coach-analyses`), `AI_ANALYSIS_PROCESSOR_FUNCTION_NAME` (default `golf-ai-analysis-processor`), S3 read/write, ffmpeg layer. | `AWS/src/frame-extractor/lambda_function.py:14` |
| `golf-ai-analysis-processor` | Fetches extracted frames, batches them through GPT-5 vision, and persists consolidated coaching output. | Direct Lambda invoke payload `{ analysis_id, user_id }`; optional SQS (`aws:sqs`) or legacy DynamoDB stream events. | `DYNAMODB_TABLE`, `USER_THREADS_TABLE`, `OPENAI_API_KEY`, `HTTP_REQUEST_TIMEOUT_MS`. | `AWS/src/ai-analysis/ai-analysis-processor.js:591` |
| `golf-results-api-handler` | Returns analysis status and payloads for polling clients. | API Gateway `GET /api/video/results/{jobId}`. | `DYNAMODB_TABLE`. | `AWS/src/api-handlers/results-api-handler.js:135` |
| `golf-chat-api-handler` | Conversational endpoint that reuses per-user OpenAI threads and applies Cognito auth. | API Gateway `POST /api/chat` with `{ message }`; accepts Cognito JWT for user context. | `USER_THREADS_TABLE`, `OPENAI_API_KEY`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `HTTP_REQUEST_TIMEOUT_MS`, optional `GOLF_COACH_ASSISTANT_ID`. | `AWS/src/api-handlers/chat-api-handler.js:511` |
| `golf-presigned-url-generator` *(external)* | Issues presigned S3 upload URLs for the mobile client. | API Gateway `POST /api/video/presigned-url`. | S3 signer role (function code lives outside this repository - confirm before changes). | _not in repo_ |

Legacy monolith `AWS/src/ai-analysis/aianalysis_lambda_code.js` remains checked in for reference but is not part of the active deployment.

## DynamoDB Tables

### `golf-coach-analyses`
- **Primary key**: `analysis_id` (string).
- **Seeded by** `golf-video-upload-handler` with: `user_id`, `user_email`, `user_name`, `user_type`, `is_authenticated`, `status='STARTED'`, `progress_message`, `s3_key`, `bucket_name`, `ai_analysis_completed=false`, timestamps (`created_at`, `updated_at`) (`AWS/src/api-handlers/video-upload-handler.js:255`).
- **Frame extraction writes** via `update_analysis_status` to set `status`, `progress_message`, and `analysis_results` (`AWS/src/frame-extractor/lambda_function.py:270`). `analysis_results` structure observed in logs:
  - `frames`: array of `{ phase, url, timestamp, description, frame_number }`.
  - `frames_extracted`, `total_frames`, `video_duration`, `fps`, `swing_detected`, optional `swing_segments` summary.
- **AI analysis writes** `ai_analysis` (JSON string containing `success`, `response`, `coaching_response`, `frames_analyzed`, `frames_skipped`, `fallback_triggered`, `tokens_used`, etc.), flips `ai_analysis_completed=true`, sets `status='AI_COMPLETED'`, updates `progress_message`, `frames_analyzed`, `frames_skipped`, and `fallback_triggered` flags (`AWS/src/ai-analysis/ai-analysis-processor.js:521`).
- **Status progression**: `STARTED` -> `PROCESSING` -> `COMPLETED` -> `AI_PROCESSING` -> `AI_COMPLETED` (failure path sets `status='FAILED'` with message overrides).
- **Secondary indexes**: `user-timestamp-index` (HASH `user_id`, RANGE `created_at`) enables fast recent-swing lookups while direct `analysis_id` reads remain primary.

### `golf-user-threads`
- **Primary key**: `user_id` (string).
- Stores OpenAI assistant thread metadata so chat and analysis share context: `thread_id`, `swing_count`, `message_count`, `created_at`, `updated_at`, `last_updated` (`AWS/src/api-handlers/chat-api-handler.js:288`).
- `golf-ai-analysis-processor` increments `swing_count` when auto-posting analyses into the thread (`AWS/src/ai-analysis/ai-analysis-processor.js:199`).
- **Secondary indexes**: none; callers fetch by `user_id`.
- Chat transcripts themselves live inside OpenAI Threads; no Dynamo table currently retains individual chat messages.

### `golf-coach-swing-profiles`
- **Primary key**: `user_id` (string).
- Populated by `golf-ai-analysis-processor` once a consolidated analysis finishes. Persists the latest coaching response, focus areas, strengths, cautions, numeric metric snapshot, and sanitized user context.
- Repository: `AWS/src/data/swingProfileRepository.js` (`getProfile`, `upsertFromAnalysis`).
- Consumed by the chat loop developer context and `get_user_swing_profile` tool to hydrate conversations with durable golfer state.

**Not present today**: Tables for session history or chat transcripts (`golf-coach-chat-sessions`, `golf-coach-users`) are referenced in legacy docs but not touched by the active codebase.\r\n\r\n## Queues & Eventing
- `infrastructure/golf-sqs-queues.yaml` provisions:
  - `golf-coach-frame-extraction-queue-{env}` + DLQ.
  - `golf-coach-ai-analysis-queue-{env}` + DLQ.
  - Managed policies for send/receive roles.
- Lambda event source mappings in the template are commented out; the running pipeline still uses direct Lambda-to-Lambda invocations. `golf-ai-analysis-processor` includes an `aws:sqs` branch for future queue hookup.

## S3 Layout
- Primary bucket: `golf-coach-videos-<account-id>`.
  - Upload path: `golf-swings/{userId}/{analysisId}.<ext>` (delivered via presigned PUT).
  - Frame extractor stores derived frames at `golf-swings/{userId}/{analysisId}/frames/{analysisId}/frame_###_Frame_at_{timestamp}s.jpg` (`AWS/src/frame-extractor/lambda_function.py:227`).
- Frame URLs saved to Dynamo drive both the AI processor and the client UI.

## API Gateway Routes
| Route | Lambda | Notes |
| --- | --- | --- |
| `POST /api/video/presigned-url` | `golf-presigned-url-generator` *(external)* | Required before uploads; confirm code location. |
| `POST /api/video/analyze` | `golf-video-upload-handler` | Starts analysis, optional Cognito auth, invokes frame extraction. |
| `GET /api/video/results/{jobId}` | `golf-results-api-handler` | Polls Dynamo for status and results. |
| `POST /api/chat` | `golf-chat-api-handler` | Conversational endpoint; when `CHAT_LOOP_ENABLED=true` it runs the swing-aware chat loop with tool access, otherwise it falls back to the legacy thread flow. |

## Video Analysis Pipeline
```mermaid
flowchart TD
    AppPresign[App: request presigned URL] --> PresignLambda[Presigned URL Lambda]
    AppUpload[App: PUT swing video to S3] --> AppNotify[App: POST /api/video/analyze]
    PresignLambda --> AppUpload
    AppNotify --> UploadLambda[golf-video-upload-handler]
    UploadLambda --> DynamoSeed[(DynamoDB: golf-coach-analyses<br/>status=STARTED)]
    UploadLambda --> FrameLambda[golf-frame-extractor-simple]
    FrameLambda --> FrameWork[Extract frames + upload to S3<br/>status=COMPLETED + analysis_results]
    FrameWork --> AIInvoke[`golf-ai-analysis-processor`]
    AIInvoke --> OpenAI[OpenAI GPT-5 batches + consolidation]
    OpenAI --> DynamoFinalize[(Update Dynamo<br/>ai_analysis + status=AI_COMPLETED)]
    DynamoFinalize --> ResultsPoll[GET /api/video/results/{jobId}]
```
Optional future path: frame extractor can enqueue jobs on `golf-coach-ai-analysis-queue-{env}` instead of direct invocation; the processor already supports `aws:sqs` events.

## Reuse Checklist
- [x] **Summary** -> `ai_analysis.coaching_response` / `ai_analysis.response` already store the consolidated narrative.
- [x] **Metrics** -> `analysis_results` (frames array, `frames_extracted`, `video_duration`, `fps`, optional `swing_segments`) and `ai_analysis.frames_analyzed`.
- [ ] **Root cause** -> Only captured inside freeform narrative today; no dedicated field.
- [ ] **Cues / drills** -> Present in narrative text but not separated into structured arrays.

## Notes & Gaps
- Presigned URL Lambda is referenced by the app but the implementation is maintained elsewhere; ensure ownership before modifications.
- SQS queues are provisioned but not wired into the running workflow; decide whether to finish that integration or keep direct invocations.
- **Swing profiles now implemented** via `golf-coach-swing-profiles` table and `AWS/src/data/swingProfileRepository.js`. The `get_user_swing_profile` tool is wired into the chat loop.
- Chat history lives inside OpenAI Threads; Dynamo keeps only thread metadata.
- Prompt logic is not fully centralized yet: chat loop uses `AWS/src/prompts/coachingSystemPrompt.js`, while video analysis currently uses inline prompts in `AWS/src/ai-analysis/ai-analysis-processor.js`.
- Legacy monolithic Lambda remains in the repo for reference but should stay dormant to avoid regressions.










