# Agent Operating Guidelines

## 0) Mission & Scope

**Purpose:** Provide broad guidelines for using automated agents to build and maintain a React Native/Expo application with an AWS serverless backend. The app is in a startup phase, so agility and rapid iteration are valued over rigid process. These instructions are meant to apply to any new feature or improvement in this repository, not a single task.

**Goals:**

- Enable the agent to make progress quickly while keeping the codebase tidy and maintainable.
- Avoid introducing unnecessary technical debt or shortcuts that would later slow down development.
- Ensure the agent doesn't hallucinate requirements or claim success when unresolved issues remain.
- Keep credentials and sensitive data safe.

## 1) Repository Conventions

### Directory Structure

```
/src/                       # React Native (Expo) source code
  /screens/                 # Main app screens (ChatScreen, SignInScreen, etc.)
  /components/              # Reusable UI components (35+ components)
  /services/                # Business logic and API integration
  /context/                 # React Context (AuthContext for Cognito auth)
  /navigation/              # React Navigation stack config
  /config/                  # AWS Amplify configuration
  /utils/                   # Design tokens (theme.js), helpers
/AWS/                       # Lambda handlers, API definitions, utilities
  /src/api-handlers/        # API Gateway Lambda handlers (chat, video, results)
  /src/ai-analysis/         # AI processing Lambda (vision-model integration; GPT-5 in AWS/src)
  /src/frame-extractor/     # Frame extraction Lambda (Python + FFmpeg)
  /src/chat/                # Chat loop with tool-use (chatLoop.js)
  /src/data/                # Data access layer (swingRepository, chatRepository, swingProfileRepository)
  /src/prompts/             # AI prompt engineering (coachingSystemPrompt.js)
  /production/              # Production-ready Lambda code
  /lambda-deployment/       # Deployment packages (.zip files)
/infrastructure/            # CloudFormation templates
  golf-sqs-queues.yaml      # SQS queue definitions (provisioned, not yet active)
  golf-dynamo-tables.yaml   # DynamoDB table definitions
/docs/                      # Documentation and runbooks
/assets/                    # Static assets (videos, images, icons)
AGENTS.md                   # This file
PROJECT_HANDOFF.md          # Engineering handoff document
```

### What to Commit

**Commit:** application code, infrastructure code, configuration templates, documentation, and automation scripts.

**Do not commit:** secrets (API keys, AWS credentials), build artifacts, node_modules, or large binary assets. Store secrets in GitHub Actions Secrets, AWS Secrets Manager/SSM Parameter Store, or .env files excluded via .gitignore. Large assets should live in S3 at runtime.

## 2) Operating Guidelines for Agents

These rules aim to balance speed with prudence in an early-stage project:

**Plan before acting:** Summarise the intended change, list the files you'll touch, and outline any commands you'll run. Seek confirmation for destructive actions (e.g. deleting files, deploying to production). For routine edits and local builds, you can proceed without pause.

**Avoid hallucinations:** If a requirement is unclear or missing, ask the user for clarification rather than inventing assumptions. Do not fabricate functions, APIs, or data structures that don't exist in the codebase.

**Don't overclaim:** When reporting results, be explicit about what was achieved and what remains to be done. If there are failing tests, unhandled errors, or incomplete paths, call them out rather than declaring victory.

**No shortcuts that undermine quality:**

- Do not hard-code secrets, API keys, or environment-specific values. Use environment variables, configuration files, or secret managers instead.
- Avoid brittle hacks that "just make it work"; favour modular functions, clear interfaces, and meaningful error handling. Small amounts of intentional debt are acceptable in a prototype, but document any known limitations.
- Handle errors and retries sensibly. For network calls, use backoff and timeouts instead of infinite loops.

**Iterate quickly but keep diffs small:** Make focused commits for each logical change. Provide concise commit messages describing what changed and why. Formal code reviews are optional at this stage; the priority is momentum, but clarity in your diffs will help future you or collaborators understand the history.

**Respect boundaries:**

- Read and modify files only within the repository unless explicitly instructed otherwise.
- For any network call or external API usage, ask for approval if it could incur cost or side effects beyond your local environment.
- Never output or store secrets in plain text.

## 3) Branching and Collaboration

Because agility is important, the branching model is lightweight:

- Use the main branch as your integration branch. Changes merged into main should be in a working state and deployable to a dev environment.
- For each feature or fix, create a short-lived branch (e.g. feature/some-feature, fix/some-bug). Push your branch to GitHub early and often.
- When the branch meets its goal (tests pass, the user is satisfied), merge it back into main. Formal pull-request reviews are optional; summarise changes and any outstanding caveats in the merge commit or description.

## 4) CI/CD and Deployments

Automate what you can, but don't let automation block progress. Typical patterns include:

- On push to main, run lints/tests and deploy a dev/staging environment via GitHub Actions using an AWS OIDC role. This keeps main always runnable.
- Optionally, tag a commit (e.g. v0.1.0) to trigger a production deployment. Manual approval gates are recommended for prod, but can be added later when the project matures.
- Keep CI workflows simple initially (install dependencies, run tests, deploy dev). Expand as the codebase and team grow.

## 5) Environment Variables and Secrets

- Never commit API keys or credentials. Use environment variables in code and reference them by name. Document required variables in README.md or a sample .env file.
- In GitHub Actions, store secrets in the repository's Secrets/Variables. In AWS, use Secrets Manager or SSM Parameter Store for runtime secrets.
- In local development, place secrets in .env.local (ignored by Git) and load them via your tooling (e.g. Expo, Node.js). Provide defaults or meaningful error messages if required vars are missing.

## 6) Code Quality and Reliability

**Keep it maintainable:** Even in a prototype, favour clear functions and modular components over tangled scripts. Write code you or others can revisit.

**Validate inputs:** Check that request parameters, environment variables, and external inputs have correct types and ranges. Surface user-friendly errors rather than letting exceptions crash the process.

**Handle errors thoughtfully:** Use try/catch (or promise .catch) around external calls. Implement retries with exponential backoff for transient network errors. Return structured error objects or HTTP status codes instead of cryptic messages.

**Logging:** Log concise, structured messages with relevant context (e.g. jobId, userId). Avoid logging personal data. Good logs aid debugging without flooding output.

**Tests:** Unit tests are encouraged for critical logic and to guard against regressions. They are not mandatory for every change during early iterations, but adding tests for key paths (e.g. main functions, AWS handlers) will save time later. Consider adding at least a "happy path" and one failure case when you introduce new modules.

## 7) Observability and Monitoring

- If you add metrics (e.g. via CloudWatch), document them in /docs for future operators. Start simple: counters for requests, successes, and failures.
- Keep an eye on logs locally and in CloudWatch for unexpected errors or performance bottlenecks.

## 8) Safety and Out-of-Scope Actions

- The agent must not expose or persist secrets (credentials, personal data).
- Do not disable security controls (IAM policies, environment restrictions) without explicit instructions.
- Do not run destructive commands (drop databases, delete resources) unless explicitly requested.
- Do not auto-deploy to production or change infrastructure without approval. Focus on code and dev/stage deployments; production gating can be added later.

## 9) Prompting Guidelines

Be explicit when asking agents to perform tasks. Describe inputs and expected outputs clearly. For example: "Create a React hook that handles file uploads with progress and retries" or "Add a Lambda handler for GET /items that validates input and returns a JSON array."

If an instruction is ambiguous, ask a clarifying question before proceeding.

Summarise your plan briefly before making code changes. List which files will be edited/created and what each modification will accomplish.

When presenting results, highlight what was changed, any assumptions made, and any next steps. If the feature isn't fully working, say so and outline remaining tasks.

---

**Final note:** Be encouraging and be a trusted advisor. You can suggest best practices that you see that aren't being implemented. Consider yourself a principal engineer to a CEO.
