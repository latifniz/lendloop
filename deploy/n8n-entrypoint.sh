#!/bin/sh
# Boot sequence for the LendLoop n8n container:
#  1. create/refresh the SMTP credential from environment variables (nothing is stored in git),
#  2. import the workflow exports (workflows are managed as code; UI edits are overwritten on restart),
#  3. activate the two business workflows (never the error handler),
#  4. start n8n.
set -eu

if [ -n "${SMTP_HOST:-}" ]; then
  node -e '
    const secure = (process.env.SMTP_SECURE || "true") === "true";
    const credential = [{
      id: "lendloop-smtp",
      name: "LendLoop SMTP",
      type: "smtp",
      data: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || (secure ? 465 : 587)),
        user: process.env.SMTP_USER || "",
        password: process.env.SMTP_PASSWORD || "",
        secure,
        disableStartTls: false,
      },
    }];
    require("fs").writeFileSync("/tmp/smtp-credential.json", JSON.stringify(credential), { mode: 0o600 });
  '
  n8n import:credentials --input=/tmp/smtp-credential.json
  rm -f /tmp/smtp-credential.json
else
  echo "SMTP_HOST is not set: no SMTP credential created. Add one in the n8n UI named 'LendLoop SMTP'." >&2
fi

for workflow in error-handler request-notification overdue-reminders; do
  n8n import:workflow --input="/workflows/${workflow}.json"
done
n8n update:workflow --id=lendloopRequestNotify --active=true
n8n update:workflow --id=lendloopOverdue --active=true

exec n8n start
