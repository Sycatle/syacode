import { ForkFlags } from "./flags"

// Claude 5.1+ binds each signed thinking block to the system prompt, the tool list and the messages above it.
// Telemetry (Oct 2026): in 13 of 21 sessions the first dropped block came right after a plan <-> build agent
// switch, which swapped plan_enter for plan_exit and changed the list of subagents in the task description. From
// then on every earlier thinking block was dropped on each call and the prompt cache was written again.
// These tools stay in the tool list whatever the agent: calling one the agent may not use returns a refusal.
export const MODE_TOOLS = ["plan_enter", "plan_exit", "enter_worktree", "exit_worktree"] as const

export function enabled(bindsThinking: boolean) {
  return bindsThinking && ForkFlags.on("STABLE_PREFIX")
}

// The tools a permission ruleset hides, minus the ones that must stay listed.
export function hidden(disabled: ReadonlySet<string>) {
  return new Set([...disabled].filter((tool) => !(MODE_TOOLS as readonly string[]).includes(tool)))
}

export function refusal(tool: string, agent: string) {
  return `${tool} is not available to the ${agent} agent. Do not call it again in this mode.`
}

// The system prompt is re-rendered on every call (date, instruction files, skills, MCP instructions), and any
// change drops every earlier thinking block. The first rendering is kept per session, agent, model and history
// start: a compaction rewrites the first message, so it renders a fresh system once. Edits to AGENTS.md or a
// new day only reach a session after its next compaction.
const frozen = new Map<string, string[]>()
const FROZEN_MAX = 500

export function freeze(key: { session: string; agent: string; model: string; first: unknown }, system: string[]) {
  const id = [key.session, key.agent, key.model, Bun.hash(JSON.stringify(key.first) ?? "")].join("\0")
  const kept = frozen.get(id)
  if (kept) return kept
  if (frozen.size >= FROZEN_MAX) frozen.delete(frozen.keys().next().value!)
  frozen.set(id, [...system])
  return system
}

export * as ForkStablePrefix from "./stable-prefix"
