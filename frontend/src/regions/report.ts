import { report } from "../../report.js";
import { messageOf } from "../errors";
import { actions } from "../store";

export type RegionName = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface ReportContext {
  region: RegionName;
  screenId: string | null;
  elementKey?: string;
}

// The same error object can surface twice (a throw inside a wrapped handler that
// also reaches the window fallback). Remembering it makes "exactly once" hold.
const reported = new WeakSet<object>();

export function wasReported(err: unknown): boolean {
  return typeof err === "object" && err !== null && reported.has(err);
}

/** The only caller of the kit's report(). Returns false if this error was already reported. */
export function reportFailure(err: unknown, ctx: ReportContext): boolean {
  if (typeof err === "object" && err !== null) {
    if (reported.has(err)) return false;
    reported.add(err);
  }
  const context: ReportContext = { region: ctx.region, screenId: ctx.screenId };
  if (ctx.elementKey) context.elementKey = ctx.elementKey;
  report(err, context);
  actions.logReport({ ...context, message: messageOf(err) });
  return true;
}
