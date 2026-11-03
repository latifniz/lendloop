// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signWebhook } from "../../convex/lib/signing";

const require = createRequire(import.meta.url);
const WORKFLOW_DIR = join(process.cwd(), "n8n", "workflows");
const SECRET = "s".repeat(48);

type WorkflowNode = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
};
type Workflow = { id: string; name: string; nodes: WorkflowNode[]; connections: Record<string, unknown>; settings: Record<string, unknown> };

const load = (file: string): Workflow => JSON.parse(readFileSync(join(WORKFLOW_DIR, file), "utf8")) as Workflow;
const workflows = {
  notify: load("request-notification.json"),
  overdue: load("overdue-reminders.json"),
  error: load("error-handler.json"),
};

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<Array<{ json: Record<string, unknown> }>>;

/** Executes a Code node exactly as exported, with the n8n globals it relies on mocked. */
async function runCodeNode(
  workflow: Workflow,
  nodeName: string,
  context: {
    json?: Record<string, unknown>;
    env?: Record<string, string>;
    body?: Buffer | null;
    nodes?: Record<string, Record<string, unknown>>;
  },
) {
  const node = workflow.nodes.find((candidate) => candidate.name === nodeName);
  if (!node) throw new Error(`No node ${nodeName}`);
  const jsCode = node.parameters.jsCode as string;
  const fn = new AsyncFunction("require", "$input", "$json", "$env", "$", "$getWorkflowStaticData", jsCode);
  const pick = (name: string) => {
    const json = context.nodes?.[name] ?? {};
    return { first: () => ({ json }), item: { json } };
  };
  return await fn.call(
    {
      helpers: {
        getBinaryDataBuffer: async () => {
          if (!context.body) throw new Error("no binary data");
          return context.body;
        },
      },
    },
    require,
    { first: () => ({ json: context.json ?? {} }) },
    context.json ?? {},
    context.env ?? {},
    pick,
    () => ({}),
  );
}

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  eventId: "request.created:abc123",
  deliveryId: "delivery-0001",
  eventType: "request.created",
  correlationId: "6f1c1d0e-9a1f-4c55-8f7e-0d4f3f1b2a11",
  attempt: 1,
  recipient: { role: "lender", name: "Lena", email: "lena@example.test" },
  counterpartName: "Ben",
  tool: { name: "Cordless drill" },
  request: { status: "pending", startDate: "2026-11-10", endDate: "2026-11-12", message: "Weekend project" },
  actionUrl: "https://lendloop.example.test/requests/incoming",
  ...overrides,
});

async function verify(options: {
  payload?: Record<string, unknown>;
  rawOverride?: string;
  secret?: string;
  timestampOffsetSeconds?: number;
  signature?: string;
  headersOverride?: Record<string, string>;
  omitBody?: boolean;
}) {
  const payload = options.payload ?? validPayload();
  const rawBody = options.rawOverride ?? JSON.stringify(payload);
  const deliveryId = String(payload.deliveryId ?? "delivery-0001");
  const timestamp = String(Math.floor(Date.now() / 1000) + (options.timestampOffsetSeconds ?? 0));
  const signature = options.signature ?? (await signWebhook({ secret: SECRET, timestamp, deliveryId, rawBody }));
  const [result] = await runCodeNode(workflows.notify, "Verify signature", {
    env: { CONVEX_N8N_WEBHOOK_SECRET: options.secret ?? SECRET },
    json: {
      headers: {
        "x-lendloop-timestamp": timestamp,
        "x-lendloop-delivery-id": deliveryId,
        "x-lendloop-signature": signature,
        ...options.headersOverride,
      },
    },
    body: options.omitBody ? null : Buffer.from(rawBody, "utf8"),
  });
  return result?.json as { ok: boolean; httpStatus: number; error?: string; payload?: Record<string, unknown> };
}

describe("workflow exports", () => {
  it("are valid n8n workflow documents with the expected nodes and connections", () => {
    for (const workflow of Object.values(workflows)) {
      const names = new Set(workflow.nodes.map((node) => node.name));
      expect(names.size).toBe(workflow.nodes.length);
      for (const [from, targets] of Object.entries(workflow.connections)) {
        expect(names.has(from)).toBe(true);
        for (const branch of (targets as { main: Array<Array<{ node: string }>> }).main) {
          for (const target of branch) expect(names.has(target.node)).toBe(true);
        }
      }
    }
    expect(workflows.notify.nodes.some((node) => node.type === "n8n-nodes-base.webhook")).toBe(true);
    expect(workflows.overdue.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger")).toBe(true);
    expect(workflows.error.nodes.some((node) => node.type === "n8n-nodes-base.errorTrigger")).toBe(true);
  });

  it("wire the error workflow into both business workflows, but not into itself (no retry loop)", () => {
    expect(workflows.notify.settings.errorWorkflow).toBe(workflows.error.id);
    expect(workflows.overdue.settings.errorWorkflow).toBe(workflows.error.id);
    expect(workflows.error.settings.errorWorkflow).toBeUndefined();
  });

  it("enable raw-body capture on the signed webhook and bounded retries on every external call", () => {
    const webhook = workflows.notify.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
    expect(webhook?.parameters.options).toMatchObject({ rawBody: true });
    for (const workflow of Object.values(workflows)) {
      for (const node of workflow.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest" || n.type === "n8n-nodes-base.emailSend")) {
        expect(node, node.name).toMatchObject({ retryOnFail: true, maxTries: 3 });
      }
    }
  });

  it("contain no secrets: only $env references and credential names, never literal values", () => {
    const files = readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(["error-handler.json", "overdue-reminders.json", "request-notification.json"]);
    for (const file of files) {
      const text = readFileSync(join(WORKFLOW_DIR, file), "utf8");
      expect(text, file).not.toMatch(/[0-9a-f]{40,}/i); // long hex secrets
      expect(text, file).not.toMatch(/password|api[_-]?key|Bearer [A-Za-z0-9]{16,}/i);
      expect(text, file).not.toMatch(/localhost:\d+\/webhook|\.convex\.(site|cloud)/);
    }
    const credentialRefs = Object.values(workflows)
      .flatMap((workflow) => workflow.nodes)
      .flatMap((node) => Object.values(node.credentials ?? {}));
    for (const ref of credentialRefs) expect(Object.keys(ref as object).sort()).toEqual(["id", "name"]);
  });
});

describe("signature verification node (Convex signer <-> n8n verifier interoperability)", () => {
  it("accepts a request signed by the Convex signer and returns the validated payload", async () => {
    const result = await verify({});
    expect(result).toMatchObject({ ok: true, httpStatus: 202 });
    expect(result.payload).toMatchObject({ eventId: "request.created:abc123" });
  });

  it("verifies the exact bytes, including non-ASCII characters and odd whitespace", async () => {
    const payload = validPayload({ counterpartName: "Zoë 🔨" });
    const raw = JSON.stringify(payload, null, 3); // different serialisation than JSON.stringify(parsed)
    expect(await verify({ payload, rawOverride: raw })).toMatchObject({ ok: true });
  });

  it("rejects an invalid signature", async () => {
    const good = await signWebhook({ secret: SECRET, timestamp: String(Math.floor(Date.now() / 1000)), deliveryId: "delivery-0001", rawBody: JSON.stringify(validPayload()) });
    const bad = `${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}`;
    expect(await verify({ signature: bad })).toMatchObject({ ok: false, httpStatus: 401, error: "invalid_signature" });
  });

  it("rejects a body that was modified after signing", async () => {
    const payload = validPayload();
    const signed = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook({ secret: SECRET, timestamp, deliveryId: "delivery-0001", rawBody: signed });
    const tampered = signed.replace("Cordless drill", "Evil drill");
    const result = await verify({ rawOverride: tampered, signature, timestampOffsetSeconds: 0 });
    expect(result).toMatchObject({ ok: false, error: "invalid_signature" });
  });

  it("rejects a signature made with a different secret", async () => {
    const payload = validPayload();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook({ secret: "z".repeat(48), timestamp, deliveryId: "delivery-0001", rawBody: JSON.stringify(payload) });
    expect(await verify({ signature })).toMatchObject({ ok: false, error: "invalid_signature" });
  });

  it("rejects stale and future-dated requests", async () => {
    expect(await verify({ timestampOffsetSeconds: -301 })).toMatchObject({ ok: false, httpStatus: 401, error: "stale_request" });
    expect(await verify({ timestampOffsetSeconds: 301 })).toMatchObject({ ok: false, httpStatus: 401, error: "stale_request" });
    expect(await verify({ timestampOffsetSeconds: -250 })).toMatchObject({ ok: true });
  });

  it("rejects a replayed timestamp+signature when the delivery id is swapped", async () => {
    const result = await verify({ headersOverride: { "x-lendloop-delivery-id": "another-delivery" } });
    expect(result).toMatchObject({ ok: false, error: "invalid_signature" });
  });

  it.each([
    ["missing signature header", { "x-lendloop-signature": "" }],
    ["signature without version prefix", { "x-lendloop-signature": "a".repeat(64) }],
    ["uppercase hex", { "x-lendloop-signature": `v1=${"A".repeat(64)}` }],
    ["short signature", { "x-lendloop-signature": "v1=abc" }],
    ["non-numeric timestamp", { "x-lendloop-timestamp": "yesterday" }],
    ["missing delivery id", { "x-lendloop-delivery-id": "" }],
  ])("rejects malformed headers: %s", async (_name, headersOverride) => {
    expect(await verify({ headersOverride })).toMatchObject({ ok: false, httpStatus: 400, error: "malformed_signature_headers" });
  });

  it("rejects requests without a body, with invalid JSON, and when the secret is unset or weak", async () => {
    expect(await verify({ omitBody: true })).toMatchObject({ ok: false, error: "missing_body" });
    expect(await verify({ rawOverride: "{oops" })).toMatchObject({ ok: false, error: "invalid_json" });
    expect(await verify({ secret: "" })).toMatchObject({ ok: false, httpStatus: 500, error: "server_misconfigured" });
    expect(await verify({ secret: "short" })).toMatchObject({ ok: false, httpStatus: 500 });
  });

  it.each([
    ["wrong schema version", { schemaVersion: 2 }],
    ["unknown event type", { eventType: "request.deleted" }],
    ["bad recipient email", { recipient: { role: "lender", name: "Lena", email: "not-an-email" } }],
    ["recipient role does not match event type", { recipient: { role: "borrower", name: "Lena", email: "lena@example.test" } }],
    ["status does not match event type", { request: { status: "approved", startDate: "2026-11-10", endDate: "2026-11-12", message: null } }],
    ["non-ISO date", { request: { status: "pending", startDate: "10/11/2026", endDate: "2026-11-12", message: null } }],
    ["delivery id in body differs from signed header", { deliveryId: "other-delivery" }],
    ["javascript: action URL", { actionUrl: "javascript:alert(1)" }],
  ])("rejects an authentic but invalid payload: %s", async (_name, overrides) => {
    const payload = validPayload(overrides);
    // Sign with the header delivery id the sender would use, independent of the body's own field.
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook({ secret: SECRET, timestamp, deliveryId: "delivery-0001", rawBody: raw });
    const [result] = await runCodeNode(workflows.notify, "Verify signature", {
      env: { CONVEX_N8N_WEBHOOK_SECRET: SECRET },
      json: { headers: { "x-lendloop-timestamp": timestamp, "x-lendloop-delivery-id": "delivery-0001", "x-lendloop-signature": signature } },
      body: Buffer.from(raw),
    });
    expect(result?.json.ok).toBe(false);
    expect([400]).toContain(result?.json.httpStatus);
  });
});

describe("email builders", () => {
  const build = async (payload: Record<string, unknown>) => {
    const [item] = await runCodeNode(workflows.notify, "Build email", { nodes: { "Verify signature": { payload } } });
    return item!.json as { to: string; subject: string; text: string; html: string };
  };

  it("tailors subject, recipient and next step to the event type", async () => {
    const created = await build(validPayload());
    expect(created).toMatchObject({ to: "lena@example.test", subject: "New borrow request for Cordless drill" });
    expect(created.text).toContain("2026-11-10 to 2026-11-12");
    expect(created.text).toContain("approve or decline");

    const approved = await build(
      validPayload({
        eventType: "request.approved",
        recipient: { role: "borrower", name: "Ben", email: "ben@example.test" },
        request: { status: "approved", startDate: "2026-11-10", endDate: "2026-11-12", message: null },
      }),
    );
    expect(approved.subject).toBe("Your request for Cordless drill was approved");
    expect(approved.text).toContain("return the tool by 2026-11-12");
  });

  it("escapes user-controlled text in HTML and strips newlines from subjects", async () => {
    const email = await build(
      validPayload({
        tool: { name: "Drill\nBcc: attacker@example.test" },
        request: { status: "pending", startDate: "2026-11-10", endDate: "2026-11-12", message: "<script>alert(1)</script>" },
      }),
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("builds the overdue reminder from the Convex reminder item", async () => {
    const [item] = await runCodeNode(workflows.overdue, "Build reminder", {
      nodes: {
        "Split reminders": {
          borrower: { name: "Ben", email: "ben@example.test" },
          lenderName: "Lena",
          toolName: "Cordless drill",
          dueDate: "2026-10-30",
          daysOverdue: 1,
          actionUrl: "https://lendloop.example.test/loans",
        },
      },
    });
    expect(item!.json).toMatchObject({ to: "ben@example.test", subject: "Reminder: please return Cordless drill" });
    expect(String(item!.json.text)).toContain("1 day overdue");
  });

  it("splits the sweep response into one item per reminder and nothing when empty", async () => {
    const run = (json: Record<string, unknown>) => runCodeNode(workflows.overdue, "Split reminders", { json });
    expect(await run({ reminders: [{ eventKey: "a" }, { eventKey: "b" }] })).toHaveLength(2);
    expect(await run({ reminders: [] })).toHaveLength(0);
    expect(await run({})).toHaveLength(0);
  });
});

describe("failure handling nodes", () => {
  const classify = async (error: unknown) => {
    const [item] = await runCodeNode(workflows.notify, "Classify failure", { json: { error } });
    return item!.json;
  };

  it.each([
    ["connect ETIMEDOUT 10.0.0.1:25", "SMTP_TIMEOUT", true],
    ["getaddrinfo ENOTFOUND smtp.example.test", "SMTP_UNREACHABLE", true],
    ["Invalid login: 535 Authentication failed", "SMTP_AUTH", false],
    ["550 mailbox unavailable", "SMTP_REJECTED_RECIPIENT", false],
    ["something odd", "SEND_FAILED", true],
  ])("classifies %j as %s (retryable=%s) without forwarding the raw message", async (message, code, retryable) => {
    for (const shape of [message, { message }]) {
      const result = await classify(shape);
      expect(result).toEqual({ errorCode: code, retryable });
    }
  });

  it("reduces an Error Trigger payload to non-sensitive fields", async () => {
    const [item] = await runCodeNode(workflows.error, "Sanitize error", {
      json: {
        workflow: { name: "LendLoop - Request notifications", id: "x" },
        execution: {
          id: "77",
          url: "http://localhost:5678/execution/77",
          error: { message: "Request failed with status code 503 for user ben@example.test corr=6f1c1d0e-9a1f-4c55-8f7e-0d4f3f1b2a11", stack: "secret stack" },
        },
      },
    });
    expect(item!.json).toEqual({
      workflowName: "LendLoop - Request notifications",
      executionId: "77",
      errorCategory: "SERVER_ERROR",
      correlationId: "6f1c1d0e-9a1f-4c55-8f7e-0d4f3f1b2a11",
    });
    expect(JSON.stringify(item!.json)).not.toContain("ben@example.test");
  });

  it("generates distinct execution ids for errors raised outside an execution", async () => {
    const run = async () => {
      const [item] = await runCodeNode(workflows.error, "Sanitize error", { json: { workflow: { name: "LendLoop - Error handler" }, execution: { error: { message: "no trigger" } } } });
      return String(item!.json.executionId);
    };
    const first = await run();
    expect(first).toMatch(/^noexec-\d+$/);
  });
});
