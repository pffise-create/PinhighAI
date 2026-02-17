# Lambda Production Snapshot

This folder contains production-oriented deployment snapshots.

## Source Of Truth
- Primary editable backend code lives in `AWS/src/`.
- Treat this directory as deployment output/reference, not the canonical implementation.

## Guidance
- Implement fixes in `AWS/src/*` first.
- Publish via deployment scripts.
- Ignore obsolete deployment instructions copied from older monolith workflows.
