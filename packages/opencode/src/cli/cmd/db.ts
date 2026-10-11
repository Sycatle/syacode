import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

const QueryCommand = effectCmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

// The event log keeps every version of every message, and a message holds its patches: the same 4.7 MB user message
// was written again after each step, 2.2 GB of a 2.5 GB database in a week. Only the latest version of a message
// matters to the projections, so older versions lose their patches. Sequence numbers stay contiguous, and the
// messages and parts tables are untouched.
const SUPERSEDED = `type = 'message.updated.1'
  AND json_extract(data, '$.info.summary.diffs') IS NOT NULL
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY json_extract(data, '$.info.id') ORDER BY seq DESC) AS rn
      FROM event WHERE type = 'message.updated.1'
    ) WHERE rn = 1
  )`

const PruneCommand = effectCmd({
  command: "prune",
  describe: "shrink the event log, then vacuum",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.option("apply", {
      type: "boolean",
      default: false,
      describe: "rewrite the log (without it, only report; a backup is written next to the database first)",
    })
  },
  handler: Effect.fn("Cli.db.prune")(function* (args: { apply: boolean }) {
    const { db } = yield* Database.Service
    const [row] = yield* db
      .all<{ events: number; mb: number }>(
        sql.raw(`SELECT COUNT(*) AS events, ROUND(COALESCE(SUM(LENGTH(data)), 0) / 1e6) AS mb FROM event WHERE ${SUPERSEDED}`),
      )
      .pipe(Effect.orDie)
    console.log(`${row.events} superseded message events carry patches (${row.mb} MB)`)
    if (!args.apply) return console.log("dry run: pass --apply to rewrite them")

    const backup = `${Database.path()}.backup-${new Date().toISOString().slice(0, 10)}`
    console.log(`backup: ${backup}`)
    yield* db.run(`VACUUM INTO '${backup.replaceAll("'", "''")}'`).pipe(Effect.orDie)
    yield* db.run(`UPDATE event SET data = json_remove(data, '$.info.summary.diffs') WHERE ${SUPERSEDED}`).pipe(Effect.orDie)
    yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)").pipe(Effect.orDie)
    yield* db.run("VACUUM").pipe(Effect.orDie)
    console.log("done")
  }),
})

export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(PruneCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
