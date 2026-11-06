# AWS Builder Daily

AWS Builder Daily drafts and, when explicitly enabled, publishes one grounded
comment on an eligible AWS Builder Center article per day. The workflow runs
on AWS Lambda, uses Amazon Bedrock Nova Micro to draft the comment, and uses
Amazon Bedrock AgentCore Browser for the authenticated Builder Center session.

The workflow is designed to be safe to preview before any public action:

- Deployment creates infrastructure, but does **not** create a schedule.
- Publishing is disabled in DynamoDB by default.
- `preview` must successfully inspect the authenticated page and its controls.
- `enable` requires `CONFIRM_PUBLICATION=YES` and a preview no older than one hour.
- Lambda retries are disabled, and each calendar day and article is reserved
  before publication to prevent duplicate attempts.

## What it creates

`deploy.py` creates the following resources in the selected AWS region:

- AWS Lambda function running Node.js 22
- Amazon DynamoDB on-demand table for configuration and run state
- Amazon Bedrock AgentCore Browser profile
- CloudWatch Logs log group with 14-day retention
- IAM roles for Lambda and EventBridge Scheduler
- An encrypted, private S3 bucket for the Lambda deployment package

The EventBridge Scheduler schedule is created only by `python admin.py enable`.
It runs at noon in the `Europe/Sofia` time zone for the configured 90-day
window. The schedule deletes itself after completion.

## Prerequisites

- An AWS account and credentials configured for the AWS CLI/SDK
- Python 3.10+ and `boto3`
- Node.js 22+ and npm
- Access to Amazon Bedrock Nova Micro in the deployment region
- Permission to use Bedrock AgentCore Browser
- An AWS Builder Center account

The AWS identity used for deployment needs permission to create the
CloudFormation, IAM, Lambda, DynamoDB, CloudWatch Logs, S3, Bedrock, and
Scheduler resources declared in `template.json`.

## Installation

From the repository directory:

```bash
npm ci
python -m pip install -r requirements.txt
cp .env.example .env
```

Set these values in the environment before deployment:

```bash
export AWS_REGION=us-east-1
export STACK_NAME=builder-daily-90
export EXPECTED_BUILDER_NAME="Your Builder Center display name"
```

`EXPECTED_BUILDER_NAME` must exactly match the display name shown by the
authenticated Builder Center account.

## Deployment and first-time setup

Run these commands in order:

```bash
python deploy.py
python admin.py login
python admin.py save-login
python admin.py preview
```

1. `deploy.py` packages the Lambda code, creates the AWS resources, and writes
   deployment outputs to the local, ignored file `deployment.json`.
2. `admin.py login` starts an AgentCore Browser session and prints an AWS
   console live-view URL. Take control of that session and sign in **only** to
   `builder.aws.com`.
3. `admin.py save-login` verifies the expected Builder identity and saves the
   authenticated session into the dedicated AgentCore Browser profile.
4. `admin.py preview` invokes Lambda in preview mode. It drafts a comment but
   does not publish it. The result must be `PREVIEW_READY`.

The login commands create `login-session.json`, which is ignored by Git and
must not be shared.

## Enable or stop publication

After reviewing a successful preview, explicitly enable the 90-day schedule:

```bash
export CONFIRM_PUBLICATION=YES
python admin.py enable
```

The command refuses to enable publication unless the preview is recent and
the authenticated page controls were validated. It also refuses to start if
the prepared start date has already passed.

To disable public actions and the schedule:

```bash
python admin.py stop
```

To inspect configuration and recorded daily/article statuses:

```bash
python admin.py status
```

## Runtime behavior

For each scheduled invocation, Lambda:

1. Checks the 90-day window and the DynamoDB kill switch.
2. Starts a browser session using the saved Builder profile.
3. Selects a recent article from the **Latest** Explore feed with comments
   enabled.
4. Sends only the article title and body to Nova Micro.
5. Requires JSON output containing a 30–600 character comment and supporting
   evidence present in the article text.
6. Reserves the article and rechecks the kill switch immediately before public
   actions.
7. Posts the comment and likes the article, then records the result.

Thin, unsuitable, or ungrounded articles are skipped. A failed or ambiguous
submission is not automatically retried; inspect the recorded status before
taking corrective action.

## Project files

| File | Purpose |
|---|---|
| `index.mjs` | Lambda handler, browser workflow, drafting, publication, and state updates |
| `core.mjs` | Date-window, URL-validation, and model-output validation helpers |
| `core.test.mjs` | Node.js tests for the core safety and date-window rules |
| `admin.py` | Login, preview, enable, stop, and status commands |
| `deploy.py` | Packages the worker and creates the AWS infrastructure |
| `login.mjs` | Opens and verifies the dedicated browser login session |
| `template.json` | CloudFormation template generated/used by deployment |
| `.env.example` | Example local configuration |

## Testing

```bash
npm test
```

Tests cover the 90-calendar-day boundary, `Europe/Sofia` date handling,
Builder article URL validation, and rejection of unsafe or promotional model
output.

## Security and operational notes

- Never commit `.env`, `deployment.json`, `login-session.json`, credentials, or
  browser session data.
- Use a dedicated Builder Center sign-in; the login helper is intended to
  navigate only to `builder.aws.com`.
- Review the generated IAM policy and CloudFormation changes before running
  deployment.
- `deploy.py` intentionally refuses to overwrite an existing stack or staging
  bucket. Inspect existing resources before retrying.
- To remove the deployment, delete the CloudFormation stack and then remove
  the deployment bucket after confirming its contents.

No license has been specified for this repository.
