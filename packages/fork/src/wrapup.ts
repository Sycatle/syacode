import { ForkFlags } from "./flags"
import type { ForkQuota } from "./quota"

// Closing a session before its limit instead of hitting it. A subscription answers 429 once a window is spent, and the
// session then resumes on a cold cache: the whole history is written again, or a bigger one is summarized from scratch.
// Close to the limit the cache is still warm, so the session compacts then (the summary replays the cached request),
// tells the user what was done, and schedules its own resumption for when the window reopens: the first call after
// the reset writes a small prefix instead of the full history. Dollar budgets (ForkBudget) close the same way.

export const DEFAULT_QUOTA = 0.95
// Wind-down starts this far below the closing threshold: the session finishes the unit of work it is on and starts
// nothing new (no subagent, workflow or background job), so there is less to wait for when the window closes.
export const WIND_DOWN_MARGIN = 0.1
// Sent after the limit reset, once the window has certainly reopened.
export const RESUME_MARGIN_MS = 60_000

export function enabled() {
  return ForkFlags.on("WRAPUP")
}

export function quotaThreshold(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.OPENCODE_FORK_WRAPUP_QUOTA)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_QUOTA
  return Math.min(value > 1 ? value / 100 : value, 1)
}

type Hit = { reset: number; used: number; window: "five_hour" | "seven_day" }

export type State = { state: "ok" } | ({ state: "wind-down" } & Hit) | ({ state: "wrap-up" } & Hit)

// The provider's windows as the last response reported them. The window that reopens last decides when work resumes.
export function quota(snapshot: ForkQuota.Snapshot | undefined, now: number, threshold = quotaThreshold()): State {
  if (!enabled() || !snapshot) return { state: "ok" }
  const open = (["five_hour", "seven_day"] as const).flatMap((id) => {
    const window = snapshot[id]
    return window && window.reset > now ? [{ window: id, reset: window.reset, used: window.utilization, rejected: window.status === "rejected" }] : []
  })
  const latest = (hits: typeof open) => hits.toSorted((a, b) => b.reset - a.reset)[0]
  const closing = latest(open.filter((hit) => hit.used >= threshold || hit.rejected))
  if (closing) return { state: "wrap-up", reset: closing.reset, used: closing.used, window: closing.window }
  const winding = latest(open.filter((hit) => hit.used >= threshold - WIND_DOWN_MARGIN))
  return winding ? { state: "wind-down", reset: winding.reset, used: winding.used, window: winding.window } : { state: "ok" }
}

export function dueAt(reset: number) {
  return reset + RESUME_MARGIN_MS
}

// Tools that start work nobody will be there to finish: refused while a window winds down (they stay listed, so the
// prefix and the signed thinking blocks keep their validity).
export const NEW_WORK_TOOLS = ["task", "workflow"] as const

export function refusal(tool: string, state: Extract<State, { state: "wind-down" }>) {
  return `${tool} is not available now: the ${state.window === "five_hour" ? "5-hour" : "weekly"} usage window is at ${Math.round(state.used * 100)}%. Finish the work in progress without starting subagents, workflows or background jobs.`
}

// /wrapup: the user asks to close the session now, whatever the windows say.
const requests = new Set<string>()
export const WRAPUP_DESCRIPTION = "close the session now: summarize, checkpoint, stop"

export function request(sessionID: string) {
  requests.add(sessionID)
}

export function consume(sessionID: string) {
  return requests.delete(sessionID)
}

export const MANUAL_PROMPT = `CRITICAL - SESSION CLOSING

The user asked to close this session. Tools are disabled. Respond with text only.

Do NOT make any tool calls. In a few lines, say what was done, what remains, and the next step to take when the work resumes.`

export function prompt(state: Extract<State, { state: "wrap-up" }>) {
  const window = state.window === "five_hour" ? "5-hour" : "weekly"
  return `CRITICAL - USAGE LIMIT CLOSE

The ${window} usage window of this provider is at ${Math.round(state.used * 100)}%. Tools are disabled. Respond with text only.

Do NOT make any tool calls. In a few lines, say what was done and what remains. The work resumes by itself when the window reopens, from the summary of this conversation.`
}

export function resumePrompt() {
  return "The usage window reopened. Continue the work from the summary above where it stopped; do not redo finished steps."
}

export * as ForkWrapup from "./wrapup"
