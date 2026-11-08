import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ForkDiscord } from "../src/discord"

describe("presence", () => {
  const base = { phase: "thinking", start: 1, project: "syacode", model: "claude-sonnet", running: 3 } as const

  test("minimal hides project and model", () => {
    const activity = ForkDiscord.presence({ ...base, privacy: "minimal" })
    expect(activity.details).toBe("Syacode")
    expect(activity.state).toBe("Réfléchit")
  })

  test("standard shows project, model and the running agent count", () => {
    const activity = ForkDiscord.presence({ ...base, privacy: "standard" })
    expect(activity.details).toBe("syacode")
    expect(activity.state).toBe("Réfléchit · claude-sonnet · 3 agents")
    expect(activity.assets?.small_image).toBe("thinking")
  })

  test("detailed adds title, tool and cost, and a lone agent is not counted", () => {
    const activity = ForkDiscord.presence({
      ...base,
      privacy: "detailed",
      phase: "tool",
      tool: "bash",
      title: "Fix bug",
      cost: 0.4,
      running: 1,
    })
    expect(activity.details).toBe("syacode — Fix bug")
    expect(activity.state).toBe("Exécute bash · claude-sonnet · $0.40")
  })

  test("an unknown privacy falls back to standard", () => {
    expect(ForkDiscord.privacy("nope")).toBe("standard")
    expect(ForkDiscord.privacy("minimal")).toBe("minimal")
  })
})

describe("ipc", () => {
  let server: Server | undefined
  let directory: string | undefined

  afterEach(async () => {
    server?.close()
    if (directory) await rm(directory, { recursive: true })
  })

  test("handshakes then sends SET_ACTIVITY over the local socket", async () => {
    directory = await mkdtemp(join(tmpdir(), "discord-ipc-"))
    const received: { op: number; payload: any }[] = []
    server = createServer((socket) => {
      socket.on("data", (chunk) => {
        const op = chunk.readInt32LE(0)
        received.push({ op, payload: JSON.parse(chunk.subarray(8, 8 + chunk.readInt32LE(4)).toString()) })
        if (op !== 0) return
        const body = Buffer.from(JSON.stringify({ cmd: "DISPATCH", evt: "READY" }))
        const head = Buffer.alloc(8)
        head.writeInt32LE(1, 0)
        head.writeInt32LE(body.length, 4)
        socket.write(Buffer.concat([head, body]))
      })
    })
    await new Promise<void>((resolve) => server!.listen(join(directory!, "discord-ipc-0"), resolve))

    const ipc = ForkDiscord.createIpc("123", { XDG_RUNTIME_DIR: directory })
    expect(await ipc.set({ details: "hello", state: "world" })).toBe(true)
    await Bun.sleep(50)
    await ipc.close()

    expect(received[0]).toEqual({ op: 0, payload: { v: 1, client_id: "123" } })
    expect(received[1].payload.cmd).toBe("SET_ACTIVITY")
    expect(received[1].payload.args.activity).toEqual({ details: "hello", state: "world" })
  })

  test("reports unreachable when Discord is not running", async () => {
    directory = await mkdtemp(join(tmpdir(), "discord-ipc-"))
    const ipc = ForkDiscord.createIpc("123", { XDG_RUNTIME_DIR: directory, TMPDIR: directory })
    expect(await ipc.set({ state: "x" })).toBe(false)
  })
})
