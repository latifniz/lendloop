import type { z } from "zod";
import { AUTOMATION } from "../../lib/constants";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { readInboundApiSecret, readInboundSigningSecret } from "./env";
import { constantTimeEqual, verifyWebhookSignature } from "./signing";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const respond = { json };

/**
 * Shared gate for every n8n -> Convex endpoint. Order matters:
 * 1) authenticate (cheap, constant-time, no DB work for strangers),
 * 2) bound the body size, 3) verify the request signature when a signing secret is configured,
 * 4) rate limit, 5) validate the schema, 6) run.
 * Responses are intentionally terse; details go to server logs without payloads.
 */
export async function handleN8nRequest<Schema extends z.ZodType>(
  ctx: ActionCtx,
  request: Request,
  options: { route: string; schema: Schema; run: (input: z.infer<Schema>) => Promise<unknown> },
): Promise<Response> {
  const secret = readInboundApiSecret();
  if (!secret.ok) {
    console.error("n8n endpoint disabled: API secret missing or too short", { route: options.route });
    return json({ error: "integration_not_configured" }, 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!presented || !(await constantTimeEqual(presented, secret.value))) {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > AUTOMATION.maxRequestBodyBytes) return json({ error: "payload_too_large" }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > AUTOMATION.maxRequestBodyBytes) {
    return json({ error: "payload_too_large" }, 413);
  }

  const signing = readInboundSigningSecret();
  if (!signing.ok) {
    console.error("n8n endpoint disabled: signing secret is set but invalid", { route: options.route });
    return json({ error: "integration_not_configured" }, 503);
  }
  if (signing.value) {
    // Same v1 scheme as Convex -> n8n; the route takes the place of the delivery id so a signature
    // for one endpoint cannot be replayed against another.
    const verdict = await verifyWebhookSignature({
      secret: signing.value,
      timestamp: request.headers.get("x-lendloop-timestamp") ?? "",
      deliveryId: new URL(request.url).pathname,
      rawBody: text,
      signature: request.headers.get("x-lendloop-signature") ?? "",
      nowSeconds: Math.floor(Date.now() / 1000),
      toleranceSeconds: AUTOMATION.signatureToleranceSeconds,
    });
    if (verdict !== "ok") return json({ error: verdict === "stale" ? "stale_request" : "invalid_signature" }, 401);
  }

  const limit = await ctx.runMutation(internal.rateLimit.consume, {
    key: "n8n-api",
    limit: AUTOMATION.n8nRateLimitPerMinute,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return json({ error: "rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
  }

  let raw: unknown;
  try {
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = options.schema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_request", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, 400);
  }

  try {
    return json(await options.run(parsed.data));
  } catch (error) {
    console.error("n8n endpoint failed", { route: options.route, name: error instanceof Error ? error.name : "unknown" });
    return json({ error: "internal_error" }, 500);
  }
}
