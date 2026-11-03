/**
 * Canonical signing scheme for Convex -> n8n webhooks (version "v1").
 *
 *   signature = "v1=" + hex(HMAC_SHA256(secret, "v1:" + timestamp + ":" + deliveryId + ":" + rawBody))
 *
 * `timestamp` is Unix seconds as a decimal string, `deliveryId` is unique per
 * delivery attempt, and `rawBody` is the exact byte-for-byte request body. The
 * receiver MUST hash the raw bytes it received and never re-serialise parsed
 * JSON. The n8n workflow implements the identical scheme (see n8n/code/).
 */
export const SIGNATURE_VERSION = "v1";
const SIGNATURE_PATTERN = /^v1=[0-9a-f]{64}$/;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalString(timestamp: string, deliveryId: string, rawBody: string): string {
  return `${SIGNATURE_VERSION}:${timestamp}:${deliveryId}:${rawBody}`;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function signWebhook(params: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  rawBody: string;
}): Promise<string> {
  const digest = await hmacSha256Hex(
    params.secret,
    canonicalString(params.timestamp, params.deliveryId, params.rawBody),
  );
  return `${SIGNATURE_VERSION}=${digest}`;
}

/** Compares two strings without leaking where they differ or how long they are. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let difference = 0;
  for (let index = 0; index < bytesA.length; index += 1) {
    difference |= (bytesA[index] ?? 0) ^ (bytesB[index] ?? 0);
  }
  return difference === 0;
}

export type VerificationResult = "ok" | "malformed" | "stale" | "mismatch";

/** Reference verifier; n8n/code/verify-signature.js mirrors this logic exactly. */
export async function verifyWebhookSignature(params: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  rawBody: string;
  signature: string;
  nowSeconds: number;
  toleranceSeconds: number;
}): Promise<VerificationResult> {
  if (!SIGNATURE_PATTERN.test(params.signature) || !/^\d{10}$/.test(params.timestamp)) return "malformed";
  if (Math.abs(params.nowSeconds - Number(params.timestamp)) > params.toleranceSeconds) return "stale";
  const expected = await signWebhook(params);
  return (await constantTimeEqual(expected, params.signature)) ? "ok" : "mismatch";
}
