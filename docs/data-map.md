# Data map: what personal data lives where

LendLoop keeps personal data to the minimum the product needs: a display name and an email address.

| Data | Where it is stored | Who can read it | Why |
| --- | --- | --- | --- |
| Name, email | Clerk (source of truth) and a copy in Convex `users` | the member (own record); admins (member list); one recipient per notification | emails are needed to notify the lender or borrower |
| Role, trusted-lender flag | Convex `users` | the member (own role); admins | access control |
| Tool name, category, condition, description | Convex `tools` | name + category: **public**; the rest: signed-in members | listing content |
| Borrower's request note | Convex `borrowRequests` | the two participants; sent to the lender in the `request.created` email only | context for the lender |
| Notification state | Convex `automationEvents` | admins | delivery status, retries, errors |
| Admin actions | Convex `auditLogs` | admins | accountability |
| Email content, recipient address | n8n execution data (failed executions kept 14 days) | n8n operators | needed to send and debug |

## Minimization decisions

- **Public page:** only `{name, category}` leaves the backend for signed-out visitors. The `returns` validator makes this a hard guarantee, and a browser test checks the real payload.
- **Other members** see a display name and a "trusted lender" flag, never an email or Clerk id.
- **Events store no personal data:** ids, status, attempts and coarse error codes only. No email addresses, message text or signatures.
- **Webhook payloads** carry one recipient, no Convex or Clerk ids, no tokens. The borrower's note goes only to the lender, only on a new request.
- **Error workflow** reports workflow name, execution id and an error category, never free-text messages (the schema rejects them).
- **Audit log** stores ids, an action name and a short non-personal detail.
- **Logs** name missing variables and correlation ids, never secrets, payloads or addresses.

## Retention (today) and what I would add

- n8n prunes successful executions immediately and failed ones after 14 days.
- `automationEvents`, `auditLogs` and `rateLimits` currently grow without bound. Production needs a scheduled cleanup, a deletion path when an account is removed, and a privacy notice naming the email provider as a processor.
