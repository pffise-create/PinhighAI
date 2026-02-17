# Lambda Deployment Staging Area

This folder contains deployment scaffolding and snapshots used by Lambda packaging scripts.

## Source Of Truth
- Primary editable backend code lives in `AWS/src/`.
- Files under `AWS/lambda-deployment/` may lag behind active source code.

## Guidance
- Make code changes in `AWS/src/*`.
- Use deployment scripts in this folder to package/publish changes.
- Ignore obsolete deployment instructions copied from older monolith workflows.
