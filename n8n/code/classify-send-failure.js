// Maps a Send Email error to a coarse, non-sensitive code and a retry hint for Convex.
// The raw error text is never forwarded: it can contain addresses or server banners.
// With "continue (using error output)" the error arrives as a string or an object, depending on the node.
const rawError = $json.error;
const text = String(
  typeof rawError === 'string' ? rawError : (rawError && (rawError.message || rawError.description)) || '',
).toLowerCase();

const rules = [
  { match: /timeout|timed out|etimedout/, code: 'SMTP_TIMEOUT', retryable: true },
  { match: /econnrefused|enotfound|econnreset|getaddrinfo|socket/, code: 'SMTP_UNREACHABLE', retryable: true },
  { match: /\b4\d\d\b|rate|too many|throttl/, code: 'SMTP_TEMPORARY', retryable: true },
  { match: /auth|535|credential/, code: 'SMTP_AUTH', retryable: false },
  { match: /recipient|mailbox|address|550|553/, code: 'SMTP_REJECTED_RECIPIENT', retryable: false },
];
const found = rules.find((rule) => rule.match.test(text));
return [{ json: { errorCode: found ? found.code : 'SEND_FAILED', retryable: found ? found.retryable : true } }];
