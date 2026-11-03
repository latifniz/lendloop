// Reduces an Error Trigger payload to non-sensitive fields before it leaves n8n.
// The error message is only inspected locally to pick a category; it is never forwarded.
const data = $json;
const message = String((data.execution && data.execution.error && data.execution.error.message) || '').toLowerCase();

const categories = [
  [/timeout|timed out|etimedout/, 'TIMEOUT'],
  [/econnrefused|enotfound|econnreset|network|socket/, 'NETWORK'],
  [/unauthorized|forbidden|401|403|credential/, 'AUTH'],
  [/429|rate limit|too many/, 'RATE_LIMIT'],
  [/\b5\d\d\b|status code 5|bad gateway|unavailable/, 'SERVER_ERROR'],
  [/smtp|mail|recipient/, 'SMTP'],
  [/invalid|validation|schema/, 'VALIDATION'],
];
const match = categories.find(([pattern]) => pattern.test(message));

const correlation = /corr[:=]([0-9a-f-]{36})/i.exec(message);
const safeName = String((data.workflow && data.workflow.name) || 'unknown').replace(/[^\w .:/#-]/g, '').slice(0, 120) || 'unknown';
// Errors raised outside an execution (e.g. activation failures) carry no id; keep records distinct.
const executionId = String((data.execution && data.execution.id) || 'noexec-' + Date.now()).replace(/[^\w-]/g, '').slice(0, 64);

const result = {
  workflowName: safeName,
  executionId,
  errorCategory: match ? match[1] : 'UNKNOWN',
};
if (correlation) result.correlationId = correlation[1];
return [{ json: result }];
