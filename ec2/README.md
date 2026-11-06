# Restore the EC2 workflow

This directory contains the EC2 implementation reconstructed from the worker and deployment changes used for the reference setup. It uses standard Chrome with a persistent profile and a fixed list of positive replies. The original AgentCore implementation is in the repository root.

## Provision AWS resources

1. Create or restore a DynamoDB table with string partition key `pk`. Preserve the existing day and article records if restoring an existing workflow.
2. Deploy `template.json` as a new CloudFormation stack, acknowledging IAM resource creation. Supply the table name, VPC, public subnet with outbound internet access, and a Canonical Ubuntu 24.04 amd64 AMI for your region. Set `ScheduleStart` and `ScheduleEnd` to UTC timestamps for your intended window. Leave `ScheduleState=DISABLED` during setup.
3. In the table, create a `CONFIG` item with string fields `pk=CONFIG`, `expectedName`, `expectedEmail`, and `startDay` (YYYY-MM-DD in Europe/Sofia), and Boolean `enabled=false`. For an existing item, preserve its other fields. The worker runs for up to 90 calendar dates from `startDay`.

## Install and verify the worker

Use Systems Manager to connect to the instance. Install Node.js 22 under `/usr/local`, Google Chrome Stable, and Xvfb from their official distribution sources. Transfer this directory to the VM, then run these commands from it:

```sh
sudo useradd --system --create-home --home-dir /var/lib/builder builder
sudo install -d -o builder -g builder -m 700 /var/lib/builder/chrome-profile /opt/builder
sudo install -m 644 index.mjs core.mjs run.mjs package.json package-lock.json /opt/builder/
sudo install -m 600 builder.env.example /opt/builder/builder.env
sudoedit /opt/builder/builder.env
cd /opt/builder
sudo env PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/npm ci --omit=dev
```

Set `AWS_REGION` and `STATE_TABLE` when editing the environment file. Back in the transferred directory, install the service units:

```sh
sudo install -m 644 systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now builder-x.service builder-browser.service
```

Use a Systems Manager port-forwarding session to reach the VM's loopback browser endpoint on port 9222 and sign in interactively with your own Builder ID. Keep that endpoint private. Run the checks on the VM:

```sh
cd /opt/builder
sudo sh -c 'set -a; . ./builder.env; set +a; exec runuser -u builder -- /usr/local/bin/node run.mjs auth-check'
sudo sh -c 'set -a; . ./builder.env; set +a; exec runuser -u builder -- /usr/local/bin/node run.mjs preview'
```

Expect `AUTHENTICATED` and `PREVIEW_READY`. Preview records its result in DynamoDB and performs no public actions.

## Activate and stop

After verification, enable `builder-job.timer` and `builder-stop.timer` with systemctl. Set the CONFIG item's `enabled` Boolean to true, then update the stack with `ScheduleState=ENABLED`. Check that the start and stop schedules target the same instance and that the VM shuts down between runs. The example times are 11:55 start, 12:00 job, and 12:15 stop, Europe/Sofia. The fallback timer stops the instance 25 minutes after activation.

To pause, set `CONFIG.enabled` to false, disable the EventBridge schedules, and stop the instance. Attached disk storage remains billable. Keep the browser profile, credentials, and account-specific environment values out of Git.
