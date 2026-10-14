import { authTokenFromCredentials } from "./server"
import type { ServerConnection } from "@/context/server"

type Target = { http: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }

export const pushSupported = () =>
  window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

export async function pushSubscription() {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  return registration?.pushManager.getSubscription()
}

function request(target: Target, path: string, init?: RequestInit) {
  const { http } = target
  return (target.fetch ?? fetch)(new URL(path, http.url), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(http.password
        ? { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
        : {}),
    },
  }).then((response) => {
    if (!response.ok) throw new Error(`Push request failed: ${response.status}`)
    return response
  })
}

// Must run from a user gesture: iOS only grants notification permission to the installed app in response to a tap.
export async function enablePush(target: Target) {
  if ((await Notification.requestPermission()) !== "granted") return false
  const registration = await navigator.serviceWorker.ready
  const key = (await (await request(target, "/global/push/key")).json()) as { publicKey: string }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.publicKey,
  })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
  await request(target, "/global/push/subscription", {
    method: "PUT",
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  })
  return true
}

export async function disablePush(target: Target) {
  const subscription = await pushSubscription()
  if (!subscription) return
  await request(target, "/global/push/subscription", {
    method: "DELETE",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  await subscription.unsubscribe()
}
