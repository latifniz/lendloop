import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { handleN8nRequest, respond } from "./lib/n8nHttp";

const http = httpRouter();

const eventKey = z.string().min(3).max(200).regex(/^[\w.:#-]+$/);
const errorCode = z.string().regex(/^[A-Z0-9_]{1,40}$/);
const label = z.string().min(1).max(120).regex(/^[\w .:/#-]+$/);

const deliveryId = z.string().min(3).max(200).regex(/^[\w.:#-]+$/);
const claimSchema = z.object({ eventId: eventKey, deliveryId: deliveryId.optional() }).strict();
const resultSchema = z
  .object({
    eventId: eventKey,
    outcome: z.enum(["sent", "failed"]),
    errorCode: errorCode.optional(),
    retryable: z.boolean().optional(),
  })
  .strict();
const overdueSchema = z.object({}).strict();
const workflowErrorSchema = z
  .object({
    workflowName: label,
    executionId: z.string().min(1).max(64).regex(/^[\w-]+$/),
    errorCategory: errorCode,
    correlationId: z.uuid().optional(),
  })
  .strict();

http.route({
  path: "/n8n/events/claim",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleN8nRequest(ctx, request, {
      route: "claim",
      schema: claimSchema,
      run: async ({ eventId, deliveryId }) => {
        const result = await ctx.runMutation(internal.automation.claimForNotification, { eventKey: eventId, deliveryId });
        return result ?? { proceed: false, reason: "unknown_event" };
      },
    }),
  ),
});

http.route({
  path: "/n8n/events/result",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleN8nRequest(ctx, request, {
      route: "result",
      schema: resultSchema,
      run: async ({ eventId, ...rest }) => {
        const result = await ctx.runMutation(internal.automation.recordResult, { eventKey: eventId, ...rest });
        return result ?? { status: "unknown", duplicate: false };
      },
    }),
  ),
});

http.route({
  path: "/n8n/overdue/run",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleN8nRequest(ctx, request, {
      route: "overdue-run",
      schema: overdueSchema,
      run: () => ctx.runMutation(internal.automation.startOverdueRun, {}),
    }),
  ),
});

http.route({
  path: "/n8n/errors",
  method: "POST",
  handler: httpAction((ctx, request) =>
    handleN8nRequest(ctx, request, {
      route: "workflow-error",
      schema: workflowErrorSchema,
      run: (input) => ctx.runMutation(internal.automation.recordWorkflowError, input),
    }),
  ),
});

// Anything else under /n8n/ is a plain 404 with no hints.
http.route({
  pathPrefix: "/n8n/",
  method: "POST",
  handler: httpAction(async () => respond.json({ error: "not_found" }, 404)),
});

export default http;
