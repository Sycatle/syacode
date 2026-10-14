import { expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Push } from "../../src/push/push"

const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: "p", auth: "a" } })

test("keeps one VAPID key and a deduplicated subscription list on disk", async () => {
  const key = await Push.publicKey()
  await Push.subscribe(subscription("https://push.example/1"))
  await Push.subscribe(subscription("https://push.example/1"))
  await Push.subscribe(subscription("https://push.example/2"))
  await Push.unsubscribe("https://push.example/2")

  const stored = await Bun.file(path.join(Global.Path.data, "push.json")).json()
  expect(stored.vapid.publicKey).toBe(key)
  expect(await Push.publicKey()).toBe(key)
  expect(stored.subscriptions.map((item: { endpoint: string }) => item.endpoint)).toEqual(["https://push.example/1"])
})
