import { ForkTelemetry } from "./telemetry"

// Cooldowns of models and providers survive a restart: a provider that answered 429 for the next hour is still
// closed after opencode is relaunched, instead of failing once more per session before the Router notices.

export function save(key: string, until: number) {
  try {
    table().query("INSERT OR REPLACE INTO fork_health (key, until) VALUES (?, ?)").run(key, until)
  } catch {}
}

export function load(now = Date.now()) {
  try {
    const db = table()
    db.query("DELETE FROM fork_health WHERE until <= ?").run(now)
    return db.query<{ key: string; until: number }, []>("SELECT key, until FROM fork_health").all()
  } catch {
    return []
  }
}

let ready = false

function table() {
  const db = ForkTelemetry.db()
  if (ready) return db
  db.run("CREATE TABLE IF NOT EXISTS fork_health (key TEXT PRIMARY KEY, until INTEGER NOT NULL)")
  ready = true
  return db
}

export * as ForkRouteHealth from "./route-health"
