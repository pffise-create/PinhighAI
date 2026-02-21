# Production Artifacts

This folder contains deployment-ready Lambda files used when publishing production builds.

## Source Of Truth
- Primary editable backend code lives in `AWS/src/`.
- Treat files in `AWS/production/` as packaged snapshots and deployment artifacts.

## Guidance
- Prefer editing `AWS/src/*` and using deployment scripts to publish updates.
- Ignore obsolete deployment instructions copied from older monolith workflows.
