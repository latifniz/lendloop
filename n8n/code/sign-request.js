// Prepended by scripts/build-n8n-workflows.mjs: `const route = "/n8n/..."; const payload = { ... };`
// Produces the exact bytes to send and, when N8N_CONVEX_SIGNING_SECRET is set, an HMAC over them.
// Scheme (v1, same as Convex -> n8n): "v1=" + hex(HMAC_SHA256(secret, "v1:" + timestamp + ":" + route + ":" + body)).
const crypto = require('crypto');

const body = JSON.stringify(payload);
const headers = {};
const secret = $env.N8N_CONVEX_SIGNING_SECRET;
if (secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = crypto.createHmac('sha256', secret).update(`v1:${timestamp}:${route}:${body}`).digest('hex');
  headers['X-LendLoop-Timestamp'] = timestamp;
  headers['X-LendLoop-Signature'] = `v1=${digest}`;
}

return { json: { ...$json, convexRequest: { body, headers } } };
