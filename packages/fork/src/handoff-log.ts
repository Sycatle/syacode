import { ForkTelemetry } from "./telemetry"
import type { Checkpoint } from "./handoff"

// Checkpoints in fork.db, one row each time a conversation was closed or moved. `usage --route` reads them next to
// the Router's decisions, to see what a move cost and where it landed.

export type Row = {
  id: number
  time: number
  session_id: string
  reason: string
  from_model: string
  to_model: string | null
  context: number
  checkpoint: string
}

export function record(cp: Checkpoint) {
  try {
    table()
      .query(
        "INSERT INTO fork_handoff (time, session_id, reason, from_model, to_model, context, checkpoint) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(cp.time, cp.session_id, cp.reason, cp.from, cp.to ?? null, cp.context, JSON.stringify(cp))
  } catch {}
}

export function latest(sessionID: string) {
  try {
    const row = table()
      .query<Row, [string]>("SELECT * FROM fork_handoff WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get(sessionID)
    return row ? { row, checkpoint: JSON.parse(row.checkpoint) as Checkpoint } : undefined
  } catch {
    return undefined
  }
}

export function recent(limit: number) {
  try {
    return table().query<Row, [number]>("SELECT * FROM fork_handoff ORDER BY id DESC LIMIT ?").all(limit)
  } catch {
    return []
  }
}

let ready = false

function table() {
  const db = ForkTelemetry.db()
  if (ready) return db
  db.run(`CREATE TABLE IF NOT EXISTS fork_handoff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    from_model TEXT NOT NULL,
    to_model TEXT,
    context INTEGER NOT NULL,
    checkpoint TEXT NOT NULL
  )`)
  db.run("CREATE INDEX IF NOT EXISTS fork_handoff_session ON fork_handoff (session_id, id)")
  ready = true
  return db
}

export * as ForkHandoffLog from "./handoff-log"
