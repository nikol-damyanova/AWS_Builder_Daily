# AWS Builder Center Daily Workflow

The [EC2 implementation and restore instructions](ec2/README.md) are in `ec2/`. The source files at the repository root are the original Lambda and AgentCore implementation.

A scheduled browser workflow that uses AWS to like and leave a short, positive comment on a recent AWS Builder Center article. It opens the **Latest** feed and selects the newest article it finds that accepts comments. A persistent Chrome profile lets the workflow reuse a Builder ID session across EC2 restarts.

## How it works

| Component | Role |
| --- | --- |
| Amazon EventBridge Scheduler | Starts and stops the EC2 instance on a daily schedule. |
| Amazon EC2 | Runs the Node.js worker through a systemd timer. A separate shutdown timer limits runtime if the scheduled stop fails. |
| Playwright and Chrome | Navigate Builder Center, check the signed-in profile, and interact with the article. |
| Amazon DynamoDB | Records daily attempts and article activity to prevent duplicate comments and unsafe retries. |
| AWS Systems Manager | Provides administrative access without inbound ports on the instance. |
| AWS CloudFormation | Provisions the VM infrastructure. Browser and worker configuration were applied separately. |

The worker checks whether the article is already liked before clicking. Comments come from a fixed list of short phrases, such as “Great post!” and “Thanks for sharing!”.

## Schedule

The reference deployment starts EC2 at **11:55**, runs the job at **12:00**, and stops EC2 at **12:15**, all in the **Europe/Sofia** time zone. The schedules have an explicit end date. Stopping EC2 limits compute usage, while the attached disk remains billable.

## Authentication

Sign in interactively with your own AWS Builder ID when setting up the browser. Chrome keeps its profile on the encrypted EC2 volume. If the saved sign-in can no longer renew and Builder asks for a password or MFA code, a new interactive sign-in is required. Keep browser profiles, credentials, and verification codes out of Git.

## Setup overview

1. Provision the EC2 foundation and configure a DynamoDB state table with access for the worker.
2. Install Node.js, Chrome, and the worker dependencies. Configure Chrome to use a persistent profile.
3. Sign in to Builder Center and run a read-only check to confirm the expected identity and article selection.
4. Configure the systemd job and backup shutdown timers. Set the EventBridge start and stop schedules with your time zone and end date.

The infrastructure template covers the foundation. The reference deployment also required separate worker installation, browser setup, and schedule configuration.

## What was tested

- The saved Builder ID session renewed after a full EC2 stop and start without a fresh password or MFA prompt.
- A manual test opened the top article in the Latest feed, applied one like, and verified that the like persisted after reloading.
- A separate test verified that a short comment appeared under the expected profile after reloading.

The manual tests covered the browser and posting steps. Scheduled execution and recovery from a fresh MFA challenge require separate verification.

## Safety

Publishing is disabled by default.

The administrative workflow includes explicit safeguards to prevent accidental publication. Review the configuration and generated content before enabling any publishing functionality.

## Testing

The core application tests can be run with:

```bash
node --test core.test.mjs
```

## License

This project is open source and is made available under the MIT License. You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, provided that the original copyright and license notice are included in all copies or substantial portions of the software.

The software is provided "as is", without warranty of any kind. See the [LICENSE](LICENSE) file for the full license terms.
