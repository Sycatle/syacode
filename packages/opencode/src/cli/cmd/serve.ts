import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ForkCache } from "@opencode-fork/core/cache"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless syacode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    // FORK-SEAM: cache-ttl (the clients of a server are interactive: web and desktop sessions pause between turns)
    process.env.OPENCODE_FORK_CACHE_TTL ??= ForkCache.INTERACTIVE_TTL
    // FORK-SEAM: prompt-suggestion (web and desktop clients show suggestions, like the TUI)
    process.env.OPENCODE_FORK_INTERACTIVE ??= "1"
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    // A restart leaves tool calls running in the database; nothing else settles them (this server owns the database).
    const { AppRuntime } = yield* Effect.promise(() => import("../../effect/app-runtime"))
    const { SessionStaleTools } = yield* Effect.promise(() => import("../../session/stale-tools"))
    yield* Effect.promise(() => AppRuntime.runPromise(SessionStaleTools.settle))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
