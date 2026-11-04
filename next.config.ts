import type { NextConfig } from "next";

/** Clerk's publishable key is `pk_<env>_<base64(frontend-api-host)$>`; the host is the only origin Clerk's scripts and API calls use. */
function clerkFrontendHost(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.split("_")[2];
  if (!encoded) return null;
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+$/i.test(host) ? host : null;
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy. Next.js needs inline scripts for hydration, so `script-src` allows
 * 'unsafe-inline' (a nonce-based policy would force every page to render dynamically).
 * Everything else is an allow-list: our origin, Clerk, Convex and Cloudflare Turnstile (Clerk's bot check).
 */
function contentSecurityPolicy(isDev: boolean): string {
  const clerk = clerkFrontendHost(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const convex = hostOf(process.env.NEXT_PUBLIC_CONVEX_URL);
  const clerkOrigin = clerk ? [`https://${clerk}`] : [];
  // Clerk's bot check probes `*.client.protect.clerk.com` on several ports, so the port needs a wildcard too.
  const protect = ["https://*.protect.clerk.com", "https://*.protect.clerk.com:*", "https://cdn.protect.clerk.com"];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...clerkOrigin, "https://challenges.cloudflare.com", ...protect],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...clerkOrigin,
      ...(convex ? [`https://${convex}`, `wss://${convex}`] : []),
      "https://clerk-telemetry.com",
      "https://challenges.cloudflare.com",
      ...protect,
    ],
    "frame-src": ["https://challenges.cloudflare.com", ...clerkOrigin],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`);
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy(process.env.NODE_ENV !== "production") },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
