import { ForkFlags } from "./flags"
import type { ForkQuota } from "./quota"

// Closing a session before its limit instead of hitting it. A subscription answers 429 once a window is spent, and the
// session then resumes on a cold cache: the whole history is written again, or a bigger one is summarized from scratch.
// Close to the limit the cache is still warm, so the session compacts then (the summary replays the cached request),
// tells the user what was done, and schedules its own resumption for when the window reopens: the first call after
// the reset writes a small prefix instead of the full history. Dollar budgets (ForkBudget) close the same way.

export const DEFAULT_QUOTA = 0.95
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

export type State =
  | { state: "ok" }
  | { state: "wrap-up"; reset: number; used: number; window: "five_hour" | "seven_day" }

// The provider's windows as the last response reported them. The window that reopens last decides when work resumes.
export function quota(snapshot: ForkQuota.Snapshot | undefined, now: number, threshold = quotaThreshold()): State {
  if (!enabled() || !snapshot) return { state: "ok" }
  const hit = (["five_hour", "seven_day"] as const)
    .flatMap((id) => {
      const window = snapshot[id]
      if (!window || window.reset <= now) return []
      if (window.utilization < threshold && window.status !== "rejected") return []
      return [{ window: id, reset: window.reset, used: window.utilization }]
    })
    .toSorted((a, b) => b.reset - a.reset)[0]
  return hit ? { state: "wrap-up", ...hit } : { state: "ok" }
}

export function dueAt(reset: number) {
  return reset + RESUME_MARGIN_MS
}

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
