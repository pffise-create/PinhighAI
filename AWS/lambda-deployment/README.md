# Lambda Deployment Staging Area

This folder contains staging files for AWS Lambda deployment.

## How it works:
1. Edit the main file: `AWS/aianalysis_lambda_code.js`
2. Copy gets placed here automatically before deployment
3. Deployment packages are created from here
4. DO NOT edit files directly in this folder - they get overwritten

## Archive:
Old versions are stored in `AWS/archive/lambda-versions/`
