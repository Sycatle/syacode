import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import ForkDiscord from "../../src/feature-plugins/fork/discord"

type Handler = (event: { properties: Record<string, unknown> }) => void

const saved = { ...process.env }
let server: Server | undefined
let directory: string | undefined

afterEach(async () => {
  process.env = { ...saved }
  server?.close()
  if (directory) await rm(directory, { recursive: true })
  server = undefined
  directory = undefined
})

function fakeApi(handlers: Map<string, Handler>, fork?: Record<string, boolean>) {
  return {
    client: { config: { get: async () => ({ data: { fork } }) } },
    event: {
      on: (type: string, handler: Handler) => {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
    },
    route: { current: { name: "session", params: { sessionID: "ses_1" } } },
    state: {
      path: { directory: "/work/syacode" },
      session: {
        get: () => ({ id: "ses_1", directory: "/work/syacode", title: "Demo" }),
        messages: () => [{ role: "assistant", modelID: "claude-sonnet", cost: 0.1 }],
      },
    },
    lifecycle: { onDispose: () => () => {} },
  } as unknown as TuiPluginApi
}

test("does nothing unless OPENCODE_FORK_DISCORD=1", async () => {
  delete process.env.OPENCODE_FORK_DISCORD
  const handlers = new Map<string, Handler>()
  await ForkDiscord.tui(fakeApi(handlers), undefined, {} as never)
  expect(handlers.size).toBe(0)
})

test("the fork block of the config enables it for a TUI attached to a shared server", async () => {
  delete process.env.OPENCODE_FORK_DISCORD
  // Point the socket lookup at an empty directory so the test never reaches a real Discord.
  process.env.XDG_RUNTIME_DIR = tmpdir()
  const handlers = new Map<string, Handler>()
  await ForkDiscord.tui(fakeApi(handlers, { DISCORD: true }), undefined, {} as never)
  expect(handlers.has("session.status")).toBe(true)
})

test("publishes the active session to the Discord socket", async () => {
  directory = await mkdtemp(join(tmpdir(), "discord-ipc-"))
  const frames: { op: number; payload: any }[] = []
  server = createServer((socket) =>
    socket.on("data", (chunk) => {
      const op = chunk.readInt32LE(0)
      frames.push({ op, payload: JSON.parse(chunk.subarray(8, 8 + chunk.readInt32LE(4)).toString()) })
      if (op !== 0) return
      const body = Buffer.from(JSON.stringify({ cmd: "DISPATCH", evt: "READY" }))
      const head = Buffer.alloc(8)
      head.writeInt32LE(1, 0)
      head.writeInt32LE(body.length, 4)
      socket.write(Buffer.concat([head, body]))
    }),
  )
  await new Promise<void>((resolve) => server!.listen(join(directory!, "discord-ipc-0"), resolve))
  process.env.OPENCODE_FORK_DISCORD = "1"
  process.env.XDG_RUNTIME_DIR = directory

  const handlers = new Map<string, Handler>()
  await ForkDiscord.tui(fakeApi(handlers), undefined, {} as never)
  handlers.get("session.status")!({ properties: { sessionID: "ses_1", status: { type: "busy" } } })
  await Bun.sleep(300)

  const activity = frames.find((frame) => frame.payload.cmd === "SET_ACTIVITY")?.payload.args.activity
  expect(activity.details).toBe("syacode")
  expect(activity.state).toBe("Réfléchit · claude-sonnet")
})
