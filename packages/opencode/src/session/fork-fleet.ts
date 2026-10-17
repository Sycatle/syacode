import { GlobalBus } from "@/bus/global"

// FORK-SEAM: fork-fleet (process-global view of the sessions that are running, across every directory)
//
// Session status and pending permissions/questions live in per-directory InstanceState, so no single instance can
// list what is running elsewhere. Every instance publishes on the process-global bus, so we fold those events here.

export type Entry = {
  directory: string | undefined
  project: string | undefined
  status: "busy" | "retry"
  // permission and question request IDs waiting on the user
  waiting: Set<string>
}

const live = new Map<string, Entry>()

export function list(): ReadonlyMap<string, Entry> {
  return live
}

GlobalBus.on("event", (event) => {
  const type: unknown = event.payload?.type
  const props = event.payload?.properties
  if (typeof type !== "string" || !props || typeof props.sessionID !== "string") return
  const sessionID: string = props.sessionID

  if (type === "session.status") {
    if (props.status?.type === "idle") return void live.delete(sessionID)
    const current = live.get(sessionID)
    live.set(sessionID, {
      directory: event.directory ?? current?.directory,
      project: event.project ?? current?.project,
      status: props.status?.type === "retry" ? "retry" : "busy",
      waiting: current?.waiting ?? new Set(),
    })
    return
  }
  if (type === "session.idle" || type === "session.deleted") return void live.delete(sessionID)

  const entry = live.get(sessionID)
  if (!entry) return
  if (type === "permission.asked" || type === "question.asked") entry.waiting.add(props.id)
  if (type === "permission.replied" || type === "question.replied" || type === "question.rejected")
    entry.waiting.delete(props.requestID)
})

export * as ForkFleet from "./fork-fleet"
