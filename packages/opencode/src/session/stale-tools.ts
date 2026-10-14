export * as SessionStaleTools from "./stale-tools"

import { Database } from "@opencode-ai/core/database/database"
import { PartTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"

/**
 * Closes tool calls a dead process left pending or running. Nothing else ever settles them, so after a restart
 * they render as in flight forever. Runs before the server accepts clients, so no event needs publishing.
 */
export const settle = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select()
    .from(PartTable)
    .where(
      sql`json_extract(${PartTable.data}, '$.type') = 'tool' and json_extract(${PartTable.data}, '$.state.status') in ('pending', 'running')`,
    )
    .all()
    .pipe(Effect.orDie)
  const end = Date.now()
  yield* Effect.forEach(
    rows.flatMap((row) => {
      // The column type drops the union, so rebuild the part to narrow it.
      const part = { ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id } as SessionV1.Part
      return part.type === "tool" ? [{ row, part }] : []
    }),
    ({ row, part }) => {
      const settled = {
        ...row.data,
        state: {
          ...part.state,
          status: "error",
          error: "Tool execution aborted",
          metadata: {
            ...("metadata" in part.state && part.state.metadata ? part.state.metadata : {}),
            interrupted: true,
          },
          time: { start: "time" in part.state ? part.state.time.start : end, end },
        },
      }
      return db.update(PartTable).set({ data: settled }).where(eq(PartTable.id, row.id)).run().pipe(Effect.orDie)
    },
    { discard: true },
  )
  if (rows.length > 0) yield* Effect.logInfo("settled stale tool calls", { count: rows.length })
})
