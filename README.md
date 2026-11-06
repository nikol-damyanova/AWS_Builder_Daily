# AWS Builder Daily

AWS Builder Daily is an automation project designed to streamline a daily content workflow for AWS Builder Center.

The project combines browser automation, AI-powered content processing, and AWS serverless services to support the creation and management of daily content.

## Architecture

The project uses the following AWS services and technologies:

- **AWS Lambda** — runs the automation workflow.
- **Amazon Bedrock (Nova Micro)** — supports AI-powered content processing.
- **Amazon Bedrock AgentCore Browser** — provides browser automation.
- **Amazon DynamoDB** — stores application configuration and state.
- **Amazon EventBridge Scheduler** — supports scheduled execution.
- **Amazon S3** — stores deployment artifacts.
- **AWS CloudFormation** — provisions infrastructure.

The application is built with Node.js and Python.

## Project Structure

| File | Description |
|---|---|
| `index.mjs` | Main application entry point |
| `core.mjs` | Core application logic |
| `core.test.mjs` | Automated tests |
| `deploy.py` | AWS deployment script |
| `admin.py` | Administrative commands |
| `login.mjs` | Browser session and identity verification |
| `template.json` | CloudFormation infrastructure template |
| `.env.example` | Example environment configuration |
| `requirements.txt` | Python dependencies |
| `package.json` | Node.js dependencies |

## Configuration

Before deployment, configure the required environment variables using `.env.example` as a reference.

You will need:

- An AWS account with the required service permissions.
- An AWS region with the necessary services available.
- Access to Amazon Bedrock and the selected model.
- An AWS Builder Center account.
- A configured AgentCore Browser session.

Never commit credentials, session files, deployment-specific configuration, or other sensitive information to the repository.

## Safety

Publishing is disabled by default.

The administrative workflow includes explicit safeguards to prevent accidental publication. Review the configuration and generated content before enabling any publishing functionality.

## Testing

The core application tests can be run with:

```bash
node --test core.test.mjs
```

## License

No license has been specified yet. All rights are reserved by default.
