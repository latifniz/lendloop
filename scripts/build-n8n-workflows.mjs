// Generates n8n/workflows/*.json from the Code-node sources in n8n/code/.
// Keeping the JavaScript in real .js files means it can be linted, read and unit
// tested (tests/n8n) instead of living as escaped strings inside JSON.
// The output references environment variables and credential *names* only.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = (file) => readFileSync(join(root, "n8n", "code", file), "utf8").trimEnd() + "\n";
const uuid = (seed) => {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const ERROR_WORKFLOW_ID = "lendloopErrorHandler";
const SMTP = { smtp: { id: "lendloop-smtp", name: "LendLoop SMTP" } };
const AUTH_HEADER = {
  parameters: [{ name: "Authorization", value: "={{ 'Bearer ' + $env.N8N_CONVEX_API_SECRET }}" }],
};
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

const node = (workflow, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters,
  id: uuid(`${workflow}:${name}`),
  name,
  type,
  typeVersion,
  position,
  ...extra,
});

const codeNode = (workflow, name, position, file) =>
  node(workflow, name, "n8n-nodes-base.code", 2, position, { mode: "runOnceForAllItems", jsCode: code(file) });

const convexCall = (workflow, name, position, path, bodyExpression, extra = {}) =>
  node(
    workflow,
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    position,
    {
      method: "POST",
      url: `={{ $env.CONVEX_SITE_URL }}${path}`,
      sendHeaders: true,
      headerParameters: AUTH_HEADER,
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify(${bodyExpression}) }}`,
      options: { timeout: 10000 },
    },
    { ...RETRY, ...extra },
  );

const ifNode = (workflow, name, position, leftValue) =>
  node(workflow, name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: uuid(`${workflow}:${name}:condition`),
          leftValue,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  });

const sendEmail = (workflow, name, position) =>
  node(
    workflow,
    name,
    "n8n-nodes-base.emailSend",
    2.1,
    position,
    {
      fromEmail: "={{ $env.LENDLOOP_FROM_EMAIL || 'LendLoop <no-reply@lendloop.local>' }}",
      toEmail: "={{ $json.to }}",
      subject: "={{ $json.subject }}",
      emailFormat: "both",
      text: "={{ $json.text }}",
      html: "={{ $json.html }}",
      options: {},
    },
    { credentials: SMTP, onError: "continueErrorOutput", retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 },
  );

const link = (node, index = 0) => ({ node, type: "main", index });
const flow = (...branches) => ({ main: branches.map((b) => b.map((target) => link(target))) });

const baseSettings = (errorWorkflow) => ({
  executionOrder: "v1",
  saveManualExecutions: true,
  // Failed executions are always kept for inspection; successful ones are pruned by n8n.
  saveDataErrorExecution: "all",
  saveDataSuccessExecution: "none",
  executionTimeout: 120,
  ...(errorWorkflow ? { errorWorkflow } : {}),
});

const workflow = (id, name, nodes, connections, settings) => ({
  id,
  name,
  nodes,
  connections,
  active: false,
  settings,
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
});

/* ------------------------- A. Request notification ------------------------- */
function requestNotification() {
  const w = "request-notification";
  const eventId = "$('Verify signature').first().json.payload.eventId";
  const nodes = [
    node(w, "Webhook", "n8n-nodes-base.webhook", 2, [0, 300], {
      httpMethod: "POST",
      path: "lendloop/request-events",
      responseMode: "responseNode",
      // Raw body: the HMAC must be computed over the exact bytes Convex signed.
      options: { rawBody: true },
    }, { webhookId: uuid(`${w}:webhook`) }),
    codeNode(w, "Verify signature", [240, 300], "verify-signature.js"),
    node(w, "Respond", "n8n-nodes-base.respondToWebhook", 1.1, [480, 300], {
      respondWith: "json",
      responseBody: "={{ { ok: $json.ok, error: $json.error || null } }}",
      options: { responseCode: "={{ $json.httpStatus }}" },
    }),
    ifNode(w, "Accepted?", [720, 300], "={{ $json.ok }}"),
    convexCall(
      w,
      "Claim event",
      [960, 200],
      "/n8n/events/claim",
      `{ eventId: ${eventId}, deliveryId: $('Verify signature').first().json.payload.deliveryId }`,
    ),
    ifNode(w, "May send?", [1200, 200], "={{ $json.proceed === true }}"),
    node(w, "Skip (already handled)", "n8n-nodes-base.noOp", 1, [1440, 360], {}),
    codeNode(w, "Build email", [1440, 100], "build-request-email.js"),
    sendEmail(w, "Send email", [1680, 100]),
    convexCall(w, "Report sent", [1920, 20], "/n8n/events/result", `{ eventId: ${eventId}, outcome: 'sent' }`),
    codeNode(w, "Classify failure", [1920, 200], "classify-send-failure.js"),
    convexCall(
      w,
      "Report failed",
      [2160, 200],
      "/n8n/events/result",
      `{ eventId: ${eventId}, outcome: 'failed', errorCode: $json.errorCode, retryable: $json.retryable }`,
    ),
  ];
  const connections = {
    Webhook: flow(["Verify signature"]),
    "Verify signature": flow(["Respond"]),
    Respond: flow(["Accepted?"]),
    "Accepted?": flow(["Claim event"], []),
    "Claim event": flow(["May send?"]),
    "May send?": flow(["Build email"], ["Skip (already handled)"]),
    "Build email": flow(["Send email"]),
    "Send email": flow(["Report sent"], ["Classify failure"]),
    "Classify failure": flow(["Report failed"]),
  };
  return workflow("lendloopRequestNotify", "LendLoop - Request notifications", nodes, connections, baseSettings(ERROR_WORKFLOW_ID));
}

/* --------------------------- B. Overdue reminders -------------------------- */
function overdueReminders() {
  const w = "overdue-reminders";
  const key = "$('Split reminders').item.json.eventKey";
  const nodes = [
    node(w, "Daily 09:00", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 200], {
      rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] },
    }),
    convexCall(w, "Run overdue sweep", [240, 200], "/n8n/overdue/run", "{}"),
    codeNode(w, "Split reminders", [480, 200], "split-reminders.js"),
    convexCall(w, "Claim reminder", [720, 200], "/n8n/events/claim", `{ eventId: ${key} }`),
    ifNode(w, "May send?", [960, 200], "={{ $json.proceed === true }}"),
    node(w, "Skip (already handled)", "n8n-nodes-base.noOp", 1, [1200, 360], {}),
    codeNode(w, "Build reminder", [1200, 100], "build-overdue-email.js"),
    sendEmail(w, "Send reminder", [1440, 100]),
    convexCall(w, "Report sent", [1680, 20], "/n8n/events/result", `{ eventId: ${key}, outcome: 'sent' }`),
    codeNode(w, "Classify failure", [1680, 200], "classify-send-failure.js"),
    convexCall(
      w,
      "Report failed",
      [1920, 200],
      "/n8n/events/result",
      `{ eventId: ${key}, outcome: 'failed', errorCode: $json.errorCode, retryable: $json.retryable }`,
    ),
  ];
  const connections = {
    "Daily 09:00": flow(["Run overdue sweep"]),
    "Run overdue sweep": flow(["Split reminders"]),
    "Split reminders": flow(["Claim reminder"]),
    "Claim reminder": flow(["May send?"]),
    "May send?": flow(["Build reminder"], ["Skip (already handled)"]),
    "Build reminder": flow(["Send reminder"]),
    "Send reminder": flow(["Report sent"], ["Classify failure"]),
    "Classify failure": flow(["Report failed"]),
  };
  return workflow("lendloopOverdue", "LendLoop - Overdue reminders", nodes, connections, baseSettings(ERROR_WORKFLOW_ID));
}

/* ------------------------------ C. Error handler --------------------------- */
function errorHandler() {
  const w = "error-handler";
  const nodes = [
    node(w, "Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 200], {}),
    codeNode(w, "Sanitize error", [240, 200], "sanitize-error.js"),
    convexCall(
      w,
      "Record failure in Convex",
      [480, 200],
      "/n8n/errors",
      "{ workflowName: $json.workflowName, executionId: $json.executionId, errorCategory: $json.errorCategory, ...($json.correlationId ? { correlationId: $json.correlationId } : {}) }",
    ),
  ];
  const connections = {
    "Error Trigger": flow(["Sanitize error"]),
    "Sanitize error": flow(["Record failure in Convex"]),
  };
  // No errorWorkflow here: a failing error handler must not trigger itself in a loop.
  return workflow(ERROR_WORKFLOW_ID, "LendLoop - Error handler", nodes, connections, baseSettings(undefined));
}

mkdirSync(join(root, "n8n", "workflows"), { recursive: true });
const outputs = {
  "request-notification.json": requestNotification(),
  "overdue-reminders.json": overdueReminders(),
  "error-handler.json": errorHandler(),
};
for (const [file, content] of Object.entries(outputs)) {
  writeFileSync(join(root, "n8n", "workflows", file), JSON.stringify(content, null, 2) + "\n");
  console.log(`wrote n8n/workflows/${file}`);
}
