import type { AuthConfig } from "convex/server";

/**
 * Convex trusts JWTs issued by Clerk. CLERK_JWT_ISSUER_DOMAIN is the Clerk
 * Frontend API URL and is configured as a Convex environment variable, never
 * in browser code. `applicationID` must match the `aud` claim ("convex").
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
