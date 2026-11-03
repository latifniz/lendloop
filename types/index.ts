import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

/** UI row types are inferred from the Convex return types so they cannot drift from the backend. */
export type BrowseTool = FunctionReturnType<typeof api.tools.listBrowse>["page"][number];
export type OwnTool = FunctionReturnType<typeof api.tools.listMine>["page"][number];
export type RequestRow = FunctionReturnType<typeof api.requests.listMine>["page"][number];
export type LoanRow = FunctionReturnType<typeof api.loans.listMine>["page"][number];
export type AdminLoanRow = FunctionReturnType<typeof api.loans.listForAdmin>["page"][number];
export type AutomationRow = FunctionReturnType<typeof api.automation.listRecent>["page"][number];
