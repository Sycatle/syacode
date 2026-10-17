// Fork: the fleet registry folds process-global bus events into the set of running sessions across directories.
import { expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { ForkFleet } from "../../src/session/fork-fleet"

const emit = (directory: string, type: string, properties: Record<string, unknown>) =>
  GlobalBus.emit("event", { directory, project: "prj_1", payload: { type, properties } })

test("tracks running sessions of different directories and their pending requests", () => {
  emit("/work/a", "session.status", { sessionID: "ses_a", status: { type: "busy" } })
  emit("/work/b", "session.status", { sessionID: "ses_b", status: { type: "retry" } })
  emit("/work/a", "permission.asked", { id: "per_1", sessionID: "ses_a" })
  emit("/work/a", "question.asked", { id: "que_1", sessionID: "ses_a" })

  const a = ForkFleet.list().get("ses_a")
  expect(a?.directory).toBe("/work/a")
  expect(a?.status).toBe("busy")
  expect(a?.waiting.size).toBe(2)
  expect(ForkFleet.list().get("ses_b")?.status).toBe("retry")

  emit("/work/a", "permission.replied", { sessionID: "ses_a", requestID: "per_1" })
  emit("/work/a", "question.rejected", { sessionID: "ses_a", requestID: "que_1" })
  expect(ForkFleet.list().get("ses_a")?.waiting.size).toBe(0)

  emit("/work/a", "session.status", { sessionID: "ses_a", status: { type: "idle" } })
  emit("/work/b", "session.idle", { sessionID: "ses_b" })
  expect(ForkFleet.list().has("ses_a")).toBe(false)
  expect(ForkFleet.list().has("ses_b")).toBe(false)
})

test("a status update keeps the pending requests of the session", () => {
  emit("/work/c", "session.status", { sessionID: "ses_c", status: { type: "busy" } })
  emit("/work/c", "permission.asked", { id: "per_2", sessionID: "ses_c" })
  emit("/work/c", "session.status", { sessionID: "ses_c", status: { type: "retry" } })
  expect(ForkFleet.list().get("ses_c")?.waiting.has("per_2")).toBe(true)
  emit("/work/c", "session.idle", { sessionID: "ses_c" })
})
