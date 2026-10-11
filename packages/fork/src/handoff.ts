import { ForkFlags } from "./flags"
import type { Facts } from "./compaction"
import { formatFacts } from "./compaction"

// A checkpoint is what a conversation needs to continue elsewhere: on another provider, or on the same one after a
// usage window reopened. It holds plain text and structured facts only. No signed thinking, no server tool blocks and
// no half-finished tool calls, none of which another provider (or the same one, with a changed prefix) can read.
// The prose summary stays in the session as its compaction message; the checkpoint carries what a model would
// otherwise have to be trusted with: the last request word for word, the todo list, the files, the git state.

export const DEFAULT_MIN_TOKENS = 20_000
const MAX_REQUEST_CHARS = 4_000

export function enabled() {
  return ForkFlags.on("HANDOFF")
}

export function minTokens(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.OPENCODE_FORK_HANDOFF_MIN)
  return Number.isFinite(value) && value >= 0 && env.OPENCODE_FORK_HANDOFF_MIN ? value : DEFAULT_MIN_TOKENS
}

export type Reason = "provider-switch" | "failover" | "usage-window" | "manual"

export type Checkpoint = {
  time: number
  session_id: string
  reason: Reason
  // "provider/model" the conversation leaves, and the one it goes to (unknown when it waits for a window).
  from: string
  to?: string
  // Tokens of the conversation at that point.
  context: number
  facts: Facts
  // Branch and diffstat of the working tree.
  git?: string
  // The last thing the user asked, word for word.
  request: string
  // When the work resumes on its own.
  resume_at?: number
}

// A conversation moves to another provider only when there is enough of it to be worth a summary, and the provider
// really changes. Inside one provider a model change keeps the history readable (reasoning becomes text).
export function needed(input: { from?: string; to: string; context: number }, min = minTokens()) {
  if (!enabled() || !input.from) return false
  return input.from.split("/")[0] !== input.to.split("/")[0] && input.context >= min
}

export function build(input: Omit<Checkpoint, "request"> & { request: string }): Checkpoint {
  const request = input.request.trim()
  return { ...input, request: request.length > MAX_REQUEST_CHARS ? `${request.slice(0, MAX_REQUEST_CHARS)}...` : request }
}

// The text a model reads to take the work over. Provider-neutral Markdown.
export function render(cp: Checkpoint) {
  const where = cp.to ? `${cp.from} to ${cp.to}` : `${cp.from}`
  const sections = [
    `## Checkpoint (${cp.reason}, ${where}, ~${Math.round(cp.context / 1000)}k tokens before)`,
    cp.request ? `### Last request, verbatim\n${cp.request}` : undefined,
    cp.git ? `### Working tree\n${cp.git}` : undefined,
    formatFacts(cp.facts),
  ].filter((section): section is string => section !== undefined)
  return sections.join("\n\n")
}

export * as ForkHandoff from "./handoff"
