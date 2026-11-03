// Verifies a Convex -> n8n webhook. Runs in an n8n Code node ("Run Once for All Items").
// Canonical scheme "v1" (must match convex/lib/signing.ts):
//   signature = "v1=" + hex(HMAC_SHA256(secret, "v1:" + timestamp + ":" + deliveryId + ":" + rawBody))
// The Webhook node has "Raw Body" enabled, so we hash the exact bytes Convex sent
// instead of re-serialising parsed JSON (which would not reproduce the same bytes).
const crypto = require('crypto');

const TOLERANCE_SECONDS = 300;
const SIGNATURE_PATTERN = /^v1=[0-9a-f]{64}$/;
const RECIPIENT_ROLE_BY_EVENT = {
  'request.created': 'lender',
  'request.approved': 'borrower',
  'request.declined': 'borrower',
  'request.cancelled': 'lender',
};
const STATUS_BY_EVENT = {
  'request.created': 'pending',
  'request.approved': 'approved',
  'request.declined': 'declined',
  'request.cancelled': 'cancelled',
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/;
const SAFE_ID = /^[\w.:#-]{3,200}$/;

const reject = (httpStatus, error) => [{ json: { ok: false, httpStatus, error } }];
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

const secret = $env.CONVEX_N8N_WEBHOOK_SECRET;
if (!secret || secret.length < 32) return reject(500, 'server_misconfigured');

const headers = $input.first().json.headers || {};
const timestamp = String(headers['x-lendloop-timestamp'] || '');
const deliveryId = String(headers['x-lendloop-delivery-id'] || '');
const signature = String(headers['x-lendloop-signature'] || '');

if (!SIGNATURE_PATTERN.test(signature) || !/^\d{10}$/.test(timestamp) || !SAFE_ID.test(deliveryId)) {
  return reject(400, 'malformed_signature_headers');
}

let rawBody;
try {
  rawBody = await this.helpers.getBinaryDataBuffer(0, 'data');
} catch (error) {
  return reject(400, 'missing_body');
}

// Freshness first (cheap), then the HMAC.
const nowSeconds = Math.floor(Date.now() / 1000);
if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return reject(401, 'stale_request');

const expected = crypto
  .createHmac('sha256', secret)
  .update('v1:' + timestamp + ':' + deliveryId + ':')
  .update(rawBody)
  .digest('hex');
const expectedBuffer = Buffer.from('v1=' + expected, 'utf8');
const presentedBuffer = Buffer.from(signature, 'utf8');
if (expectedBuffer.length !== presentedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, presentedBuffer)) {
  return reject(401, 'invalid_signature');
}

// Replay protection is layered: the timestamp window above bounds how long a captured
// request stays usable, and Convex accepts each signed deliveryId exactly once at
// /n8n/events/claim (authoritative, transactional). Workflow static data is deliberately
// NOT used: it did not persist reliably across webhook executions in testing.

let payload;
try {
  payload = JSON.parse(rawBody.toString('utf8'));
} catch (error) {
  return reject(400, 'invalid_json');
}

// Schema validation (n8n has no zod; keep this strict and explicit).
const valid =
  payload &&
  payload.schemaVersion === 1 &&
  SAFE_ID.test(String(payload.eventId)) &&
  payload.deliveryId === deliveryId &&
  UUID.test(String(payload.correlationId)) &&
  Object.prototype.hasOwnProperty.call(RECIPIENT_ROLE_BY_EVENT, payload.eventType) &&
  Number.isInteger(payload.attempt) &&
  payload.recipient &&
  isText(payload.recipient.name, 100) &&
  EMAIL.test(String(payload.recipient.email)) &&
  isText(payload.counterpartName, 100) &&
  payload.tool &&
  isText(payload.tool.name, 80) &&
  payload.request &&
  ISO_DAY.test(String(payload.request.startDate)) &&
  ISO_DAY.test(String(payload.request.endDate)) &&
  (payload.request.message === null || isText(payload.request.message, 500)) &&
  typeof payload.actionUrl === 'string' &&
  /^https?:\/\//.test(payload.actionUrl);
if (!valid) return reject(400, 'invalid_payload');

// n8n decides the recipient from the event type and cross-checks what Convex sent.
if (payload.recipient.role !== RECIPIENT_ROLE_BY_EVENT[payload.eventType]) return reject(400, 'recipient_mismatch');
if (payload.request.status !== STATUS_BY_EVENT[payload.eventType]) return reject(400, 'status_mismatch');

return [{ json: { ok: true, httpStatus: 202, payload } }];
