export * as ForkDiscord from "./discord"

import { connect, type Socket } from "node:net"

// Discord Rich Presence for the TUI: a pure activity builder and a client of the local Discord IPC socket.

export const CLIENT_ID = "1568966842276647135"

export type Privacy = "minimal" | "standard" | "detailed"
export type Phase = "idle" | "thinking" | "tool" | "waiting" | "error"

export type Activity = {
  details?: string
  state?: string
  timestamps?: { start: number }
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string }
}

const LABELS: Record<Phase, string> = {
  idle: "En veille",
  thinking: "Réfléchit",
  tool: "Exécute un outil",
  waiting: "Attend une validation",
  error: "Erreur",
}

// Highest rank wins when several sessions of a family are active at once.
export const RANK: Phase[] = ["idle", "thinking", "tool", "error", "waiting"]

export function privacy(value: string | undefined): Privacy {
  return value === "minimal" || value === "detailed" ? value : "standard"
}

export function presence(input: {
  privacy: Privacy
  phase: Phase
  start: number
  project?: string
  model?: string
  title?: string
  tool?: string
  cost?: number
  running: number
}): Activity {
  const detailed = input.privacy === "detailed"
  const label = detailed && input.phase === "tool" && input.tool ? `Exécute ${input.tool}` : LABELS[input.phase]
  const assets = {
    large_image: "syacode",
    large_text: "SYA Code",
    small_image: input.phase,
    small_text: LABELS[input.phase],
  }
  const timestamps = { start: input.start }
  if (input.privacy === "minimal") return { details: "SYA Code", state: LABELS[input.phase], timestamps, assets }

  return {
    details: clamp([input.project ?? "SYA Code", detailed ? input.title : undefined].filter(Boolean).join(" — ")),
    state: clamp(
      [
        label,
        input.model,
        input.running > 1 ? `${input.running} agents` : undefined,
        detailed && input.cost ? `$${input.cost.toFixed(2)}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    timestamps,
    assets,
  }
}

// Discord rejects fields shorter than 2 or longer than 128 characters.
function clamp(value: string) {
  return value.length > 128 ? `${value.slice(0, 127)}…` : value.padEnd(2)
}

const HANDSHAKE = 0
const FRAME = 1
const CLOSE = 2
const PING = 3
const PONG = 4

// Frames are `[opcode: int32le][length: int32le][json]`. The client connects lazily and reconnects on the next
// `set` after a drop, so Discord may start after us.
export function createIpc(clientID: string, environment: Record<string, string | undefined> = process.env) {
  let session: Promise<Socket | undefined> | undefined
  let nonce = 0

  const open = () =>
    (session ??= handshake(clientID, socketPaths(environment)).then((socket) => {
      if (!socket) return (session = undefined)
      socket.once("close", () => (session = undefined))
      return socket
    }))

  return {
    // Sets the presence, or clears it when `activity` is undefined. Resolves to false when Discord is unreachable.
    async set(activity: Activity | undefined) {
      const socket = await open()
      if (!socket) return false
      socket.write(
        encode(FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: String(nonce++) }),
      )
      return true
    },
    async close() {
      const socket = await session
      session = undefined
      socket?.end()
    },
  }
}

export function socketPaths(environment: Record<string, string | undefined>) {
  const slots = Array.from({ length: 10 }, (_, index) => `discord-ipc-${index}`)
  if (process.platform === "win32") return slots.map((slot) => `\\\\?\\pipe\\${slot}`)
  const roots = [environment.XDG_RUNTIME_DIR, environment.TMPDIR, environment.TMP, environment.TEMP, "/tmp"].filter(
    (root): root is string => Boolean(root),
  )
  // Flatpak and Snap builds of Discord place the socket in a per-app subdirectory.
  const subdirectories = ["", "app/com.discordapp.Discord/", "snap.discord/"]
  return [
    ...new Set(roots.flatMap((root) => subdirectories.flatMap((sub) => slots.map((slot) => `${root}/${sub}${slot}`)))),
  ]
}

async function handshake(clientID: string, paths: string[]) {
  for (const path of paths) {
    const socket = await tryConnect(path)
    if (socket && (await ready(socket, clientID))) return socket
    socket?.destroy()
  }
}

function tryConnect(path: string) {
  return new Promise<Socket | undefined>((resolve) => {
    const socket = connect(path)
    socket.once("connect", () => resolve(socket))
    socket.on("error", () => resolve(undefined))
  })
}

function ready(socket: Socket, clientID: string) {
  return new Promise<boolean>((resolve) => {
    let buffer = Buffer.alloc(0)
    let settled = false
    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(ok)
    }
    const timeout = setTimeout(() => settle(false), 5000)

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0)
        const length = buffer.readInt32LE(4)
        if (buffer.length < 8 + length) return
        const payload = buffer.subarray(8, 8 + length).toString()
        buffer = buffer.subarray(8 + length)
        if (op === PING) socket.write(encode(PONG, JSON.parse(payload)))
        if (op === CLOSE) settle(false)
        if (op === FRAME && JSON.parse(payload).evt === "READY") settle(true)
      }
    })
    socket.on("error", () => settle(false))
    socket.once("close", () => settle(false))
    socket.write(encode(HANDSHAKE, { v: 1, client_id: clientID }))
  })
}

function encode(op: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}
