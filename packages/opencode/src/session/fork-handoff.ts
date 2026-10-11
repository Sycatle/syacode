import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ForkCompaction } from "@opencode-fork/core/compaction"
import { ForkHandoff } from "@opencode-fork/core/handoff"
import { ForkHandoffLog } from "@opencode-fork/core/handoff-log"
import { Effect } from "effect"

// Fork-owned glue for packages/fork/src/handoff.ts (see docs/fork/seams.md).

// Writes the checkpoint of a conversation that is about to change provider or wait for a window. The summary itself
// is the compaction message the caller asks for next; this keeps what must not depend on a model's memory.
export const checkpoint = Effect.fn("ForkHandoff.checkpoint")(function* (input: {
  sessionID: string
  directory: string
  messages: SessionV1.WithParts[]
  reason: ForkHandoff.Reason
  from: string
  to?: string
  context: number
  resumeAt?: number
}) {
  const request = input.messages
    .findLast(
      (message) =>
        message.info.role === "user" &&
        message.parts.some((part) => part.type === "text" && !part.synthetic && !part.ignored),
    )
    ?.parts.flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
    .join("\n")
  const value = ForkHandoff.build({
    time: Date.now(),
    session_id: input.sessionID,
    reason: input.reason,
    from: input.from,
    to: input.to,
    context: input.context,
    facts: ForkCompaction.facts(input.messages),
    git: yield* git(input.directory),
    request: request ?? "",
    resume_at: input.resumeAt,
  })
  ForkHandoffLog.record(value)
  return value
})

// Branch and diffstat of the working tree; nothing outside a git repository.
const git = (directory: string) =>
  Effect.try({
    try: () => {
      const run = (...args: string[]) => {
        const out = Bun.spawnSync(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "ignore" })
        return out.success ? out.stdout.toString().trim() : ""
      }
      const branch = run("rev-parse", "--abbrev-ref", "HEAD")
      if (!branch) return undefined
      const stat = run("diff", "--shortstat", "HEAD")
      return `branch ${branch}${stat ? `, ${stat}` : ", clean"}`
    },
    catch: (error) => error,
  }).pipe(Effect.orElseSucceed(() => undefined))

export * as ForkHandoffRun from "./fork-handoff"
