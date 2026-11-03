/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as automation from "../automation.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_n8nHttp from "../lib/n8nHttp.js";
import type * as lib_outbox from "../lib/outbox.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_signing from "../lib/signing.js";
import type * as lib_stateMachine from "../lib/stateMachine.js";
import type * as lib_validation from "../lib/validation.js";
import type * as loans from "../loans.js";
import type * as rateLimit from "../rateLimit.js";
import type * as requests from "../requests.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  automation: typeof automation;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/env": typeof lib_env;
  "lib/errors": typeof lib_errors;
  "lib/n8nHttp": typeof lib_n8nHttp;
  "lib/outbox": typeof lib_outbox;
  "lib/permissions": typeof lib_permissions;
  "lib/signing": typeof lib_signing;
  "lib/stateMachine": typeof lib_stateMachine;
  "lib/validation": typeof lib_validation;
  loans: typeof loans;
  rateLimit: typeof rateLimit;
  requests: typeof requests;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
