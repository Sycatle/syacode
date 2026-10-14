export * as Push from "./push"

import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import path from "path"
import webpush from "web-push"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { AppRuntime } from "@/effect/app-runtime"

export const Subscription = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
})
export type Subscription = typeof Subscription.Type

const State = Schema.Struct({
  vapid: Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }),
  subscriptions: Schema.Array(Subscription),
})
type State = typeof State.Type

// Browsers require a contact URL in the VAPID claim; push services only use it to reach the sender.
const VAPID_SUBJECT = "https://opencode.ai"
const file = () => Bun.file(path.join(Global.Path.data, "push.json"))
const decode = Schema.decodeUnknownOption(State)

let cached: Promise<State> | undefined
let queue = Promise.resolve()

function load() {
  cached ??= (async () => {
    const stored = file()
    const state = (await stored.exists()) ? decode(await stored.json().catch(() => undefined)) : undefined
    if (state && state._tag === "Some") return state.value
    const keys = webpush.generateVAPIDKeys()
    const created: State = { vapid: { publicKey: keys.publicKey, privateKey: keys.privateKey }, subscriptions: [] }
    await Bun.write(stored, JSON.stringify(created))
    return created
  })()
  return cached
}

// Subscriptions change from concurrent requests and the event listener; serialize the read-modify-write.
function update(change: (state: State) => State) {
  queue = queue.then(async () => {
    const next = change(await load())
    cached = Promise.resolve(next)
    await Bun.write(file(), JSON.stringify(next))
  })
  return queue
}

export async function publicKey() {
  return (await load()).vapid.publicKey
}

export const subscribe = (subscription: Subscription) =>
  update((state) => ({
    ...state,
    subscriptions: [...state.subscriptions.filter((item) => item.endpoint !== subscription.endpoint), subscription],
  }))

export const unsubscribe = (endpoint: string) =>
  update((state) => ({ ...state, subscriptions: state.subscriptions.filter((item) => item.endpoint !== endpoint) }))

async function send(notice: { title: string; body: string; tag: string; sessionID: string }) {
  const state = await load()
  const payload = JSON.stringify(notice)
  await Promise.all(
    state.subscriptions.map((subscription) =>
      webpush
        .sendNotification(subscription, payload, {
          vapidDetails: { subject: VAPID_SUBJECT, ...state.vapid },
          TTL: 60 * 60,
          urgency: "high",
        })
        // 404 and 410 mean the browser dropped the subscription for good.
        .catch((error: unknown) =>
          error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode)
            ? unsubscribe(subscription.endpoint)
            : undefined,
        ),
    ),
  )
}

const title = (sessionID: string) =>
  AppRuntime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const row = yield* db
        .select({ title: SessionTable.title })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID as never))
        .get()
        .pipe(Effect.orDie)
      return row?.title ?? "Session"
    }),
  ).catch(() => "Session")

const busy = new Set<string>()
let started = false

/** Notifies subscribed browsers when a session needs an answer, finishes, or fails. Call once per server. */
export function start() {
  if (started) return
  started = true
  GlobalBus.on("event", (event: GlobalEvent) => void notify(event.payload).catch(() => undefined))
}

async function notify(payload: { type: string; properties: Record<string, any> }) {
  const properties = payload.properties
  if (payload.type === "permission.asked") {
    return send({
      title: await title(properties.sessionID),
      body: `${properties.permission}: ${properties.patterns.join(", ")}`,
      tag: `permission:${properties.id}`,
      sessionID: properties.sessionID,
    })
  }
  if (payload.type === "question.asked") {
    return send({
      title: await title(properties.sessionID),
      body: properties.questions[0]?.question ?? "Question",
      tag: `question:${properties.id}`,
      sessionID: properties.sessionID,
    })
  }
  if (payload.type === "session.error") {
    if (!properties.sessionID) return
    return send({
      title: await title(properties.sessionID),
      body: "Stopped with an error",
      tag: `status:${properties.sessionID}`,
      sessionID: properties.sessionID,
    })
  }
  if (payload.type !== "session.status") return
  const sessionID: string = properties.sessionID
  if (properties.status.type === "busy") return void busy.add(sessionID)
  // Retry statuses are not an end; only the busy -> idle transition is.
  if (properties.status.type !== "idle" || !busy.delete(sessionID)) return
  return send({ title: await title(sessionID), body: "Finished", tag: `status:${sessionID}`, sessionID })
}
