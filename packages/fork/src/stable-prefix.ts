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

export * as ForkStablePrefix from "./stable-prefix"
