import { z } from "zod";
import { appError } from "./errors";

/**
 * Integration configuration lives in Convex environment variables (never in
 * browser bundles). It is validated at the integration boundary so a missing or
 * malformed value fails closed with a clear server-side log line.
 */
const secretSchema = z.string().min(32, "must be at least 32 characters");

const webhookUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  const isLocal = ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname);
  return url.protocol === "https:" || (url.protocol === "http:" && isLocal);
}, "must use https (http is only allowed for localhost)");

const integrationEnvSchema = z.object({
  N8N_WEBHOOK_URL: webhookUrlSchema,
  CONVEX_N8N_WEBHOOK_SECRET: secretSchema,
  APP_URL: z.url(),
});

export type OutboundIntegrationConfig = {
  webhookUrl: string;
  webhookSecret: string;
  appUrl: string;
};

type EnvSource = Record<string, string | undefined>;

export type EnvResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function describe(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

export function readOutboundConfig(env: EnvSource = process.env): EnvResult<OutboundIntegrationConfig> {
  // Pick keys explicitly: Convex's process.env is not a plain object, so parsing it whole sees nothing.
  const parsed = integrationEnvSchema.safeParse({
    N8N_WEBHOOK_URL: env.N8N_WEBHOOK_URL,
    CONVEX_N8N_WEBHOOK_SECRET: env.CONVEX_N8N_WEBHOOK_SECRET,
    APP_URL: env.APP_URL,
  });
  if (!parsed.success) return { ok: false, problems: describe(parsed.error) };
  return {
    ok: true,
    value: {
      webhookUrl: parsed.data.N8N_WEBHOOK_URL,
      webhookSecret: parsed.data.CONVEX_N8N_WEBHOOK_SECRET,
      appUrl: parsed.data.APP_URL.replace(/\/$/, ""),
    },
  };
}

export function readInboundApiSecret(env: EnvSource = process.env): EnvResult<string> {
  const parsed = z.object({ N8N_CONVEX_API_SECRET: secretSchema }).safeParse({
    N8N_CONVEX_API_SECRET: env.N8N_CONVEX_API_SECRET,
  });
  if (!parsed.success) return { ok: false, problems: describe(parsed.error) };
  return { ok: true, value: parsed.data.N8N_CONVEX_API_SECRET };
}

export function readAppUrl(env: EnvSource = process.env): string {
  const parsed = z.url().safeParse(env.APP_URL);
  if (!parsed.success) throw appError("INVALID_STATE", "APP_URL is not configured.");
  return parsed.data.replace(/\/$/, "");
}
