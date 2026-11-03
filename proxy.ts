import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * First line of defence only (redirects anonymous visitors to sign-in). The real
 * security boundary is Convex, which re-authenticates every query and mutation.
 */
const isPrivateRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/tools(.*)",
  "/requests(.*)",
  "/loans(.*)",
  "/admin(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPrivateRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
