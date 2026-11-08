import { basename } from "node:path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { ForkDiscord } from "@opencode-fork/core/discord"
import { ForkFlags } from "@opencode-fork/core/flags"
import type { BuiltinTuiPlugin } from "../builtins"

// Discord Rich Presence of the active session (see docs/fork/seams.md). Opt-in: OPENCODE_FORK_DISCORD=1.

const id = "fork:discord"
const MIN_INTERVAL = 15_000
const ERROR_TTL = 60_000

const tui: TuiPlugin = async (api) => {
  // The `fork` block is applied where the config loads; a TUI attached to a shared server never sees it, so apply it here too.
  ForkFlags.apply((await api.client.config.get()).data?.fork)
  if (ForkFlags.raw("DISCORD") !== "1") return

  const privacy = ForkDiscord.privacy(ForkFlags.raw("DISCORD_PRIVACY"))
  const discord = ForkDiscord.createIpc(ForkFlags.raw("DISCORD_CLIENT_ID") ?? ForkDiscord.CLIENT_ID)
  const start = Date.now()
  const running = new Set<string>()
  const phases = new Map<string, ForkDiscord.Phase>()
  const tools = new Map<string, string>()
  const waiting = new Map<string, string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let flush: ReturnType<typeof setTimeout> | undefined
  let sentAt = 0
  let sent = ""

  const root = (sessionID: string): string => {
    const parent = api.state.session.get(sessionID)?.parentID
    return parent ? root(parent) : sessionID
  }

  const build = () => {
    const current = api.route.current
    const focus = current.name === "session" ? (current.params as { sessionID: string }).sessionID : [...running][0]
    const family = focus ? root(focus) : undefined
    const members = family
      ? [...new Set([...phases.keys(), ...waiting.values()])].filter((member) => root(member) === family)
      : []
    const phase = members.reduce<ForkDiscord.Phase>((best, member) => {
      const next = [...waiting.values()].includes(member) ? "waiting" : phases.get(member)
      return next && ForkDiscord.RANK.indexOf(next) > ForkDiscord.RANK.indexOf(best) ? next : best
    }, "idle")
    const session = focus ? api.state.session.get(focus) : undefined
    const assistants = focus
      ? api.state.session.messages(focus).filter((item): item is AssistantMessage => item.role === "assistant")
      : []
    return ForkDiscord.presence({
      privacy,
      phase,
      start,
      project: basename(session?.directory ?? api.state.path.directory),
      model: assistants.at(-1)?.modelID,
      title: session?.title,
      tool: members.map((member) => tools.get(member)).find(Boolean),
      cost: assistants.reduce((total, item) => total + item.cost, 0),
      running: running.size,
    })
  }

  // Updates are coalesced and spaced out so the profile never exceeds Discord's rate limit.
  const refresh = () => {
    if (flush) return
    flush = setTimeout(
      async () => {
        flush = undefined
        const activity = build()
        const key = JSON.stringify(activity)
        if (key === sent) return
        sentAt = Date.now()
        if (await discord.set(activity)) sent = key
      },
      Math.max(50, sentAt + MIN_INTERVAL - Date.now()),
    )
  }

  const set = (sessionID: string, phase: ForkDiscord.Phase, tool?: string) => {
    phases.set(sessionID, phase)
    if (tool) tools.set(sessionID, tool)
    else tools.delete(sessionID)
    refresh()
  }
  const wait = (requestID: string, sessionID: string) => {
    waiting.set(requestID, sessionID)
    refresh()
  }
  const resume = (requestID: string) => {
    waiting.delete(requestID)
    refresh()
  }

  const dispose = [
    api.event.on("session.status", (event) => {
      const sessionID = event.properties.sessionID
      if (event.properties.status.type !== "idle") {
        running.add(sessionID)
        if (!phases.has(sessionID)) set(sessionID, "thinking")
        return
      }
      running.delete(sessionID)
      tools.delete(sessionID)
      // A failed session goes idle right after the error; the error stays visible until its TTL.
      if (phases.get(sessionID) !== "error") phases.delete(sessionID)
      refresh()
    }),
    api.event.on("message.part.updated", (event) => {
      const part = event.properties.part
      if (part.type === "tool") {
        const active = part.state.status === "pending" || part.state.status === "running"
        set(part.sessionID, active ? "tool" : "thinking", active ? part.tool : undefined)
        return
      }
      if (part.type === "text" || part.type === "reasoning") set(part.sessionID, "thinking")
    }),
    api.event.on("session.error", (event) => {
      const sessionID = event.properties.sessionID
      if (!sessionID) return
      set(sessionID, "error")
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (phases.get(sessionID) === "error") {
          phases.delete(sessionID)
          refresh()
        }
      }, ERROR_TTL)
      timers.add(timer)
    }),
    api.event.on("permission.asked", (event) => wait(event.properties.id, event.properties.sessionID)),
    api.event.on("permission.replied", (event) => resume(event.properties.requestID)),
    api.event.on("question.asked", (event) => wait(event.properties.id, event.properties.sessionID)),
    api.event.on("question.replied", (event) => resume(event.properties.requestID)),
    api.event.on("question.rejected", (event) => resume(event.properties.requestID)),
  ]
  refresh()

  api.lifecycle.onDispose(() => {
    dispose.reverse().forEach((cleanup) => cleanup())
    clearTimeout(flush)
    timers.forEach(clearTimeout)
    return discord.set(undefined).then(() => discord.close())
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
