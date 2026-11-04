import { expect, test } from "@playwright/test";

test.describe("signed-out visitor", () => {
  test("landing page shows the tagline, a sign-in call to action and a name+category-only tool list", async ({ page }) => {
    const toolKeys = new Set<string>();
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        try {
          const walk = (value: unknown): void => {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === "object") {
              const record = value as Record<string, unknown>;
              if ("name" in record && "category" in record) Object.keys(record).forEach((key) => toolKeys.add(key));
              Object.values(record).forEach(walk);
            }
          };
          walk(JSON.parse(String(frame.payload)));
        } catch {
          /* not a JSON frame */
        }
      }),
    );
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Borrow what you need").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in to lend or borrow/i }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    // The public Convex query must return nothing but name and category (no owner, id or description).
    expect([...toolKeys].sort()).toEqual(toolKeys.size === 0 ? [] : ["category", "name"]);
    await expect(page.locator("body")).not.toContainText(/@[\w-]+\./);
  });

  test("sends a Content-Security-Policy and the other hardening headers", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBeTruthy();
  });

  test("has a favicon: icon links in the page, and the icon files are served as images", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"]').evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.some((href) => href.includes("icon.svg"))).toBe(true);
    expect(hrefs.some((href) => href.includes("apple-icon"))).toBe(true);
    for (const path of ["/icon.svg", "/apple-icon.png", "/favicon.ico"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^image\//);
    }
  });

  for (const path of ["/dashboard", "/tools", "/tools/mine", "/requests", "/requests/incoming", "/loans", "/admin"]) {
    test(`redirects ${path} to sign-in`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/sign-in/);
    });
  }

  test("logs no Content-Security-Policy violations while loading the landing page", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text().slice(0, 160));
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
});

test.describe("n8n (only when E2E_N8N_URL is set)", () => {
  test.skip(!process.env.E2E_N8N_URL, "set E2E_N8N_URL to check the automation endpoint");

  test("is healthy and refuses an unsigned webhook", async ({ request }) => {
    const base = process.env.E2E_N8N_URL!.replace(/\/$/, "");
    expect((await request.get(`${base}/healthz`)).ok()).toBe(true);
    const forged = await request.post(`${base}/webhook/lendloop/request-events`, { data: { forged: true }, failOnStatusCode: false });
    expect(forged.status()).toBeGreaterThanOrEqual(400);
  });
});
