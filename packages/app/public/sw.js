// Notifications only: no fetch handler, so the app is never served from a cache here.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

// Web Push from the server: a session needs an answer, finished, or failed.
self.addEventListener("push", (event) => {
  const payload = event.data?.json()
  if (!payload) return
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // The open tab already shows its own in-app notification.
      if (windows.some((client) => client.visibilityState === "visible")) return
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        data: { sessionID: payload.sessionID },
        icon: "/favicon-96x96-v3.png",
      })
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const { tag, data } = event.notification
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows[0]
      if (!open) {
        const target = data?.sessionID ? `/?session=${encodeURIComponent(data.sessionID)}` : (data?.url ?? "/")
        return self.clients.openWindow(target)
      }
      open.postMessage({ type: "notification-click", tag, sessionID: data?.sessionID })
      return open.focus()
    }),
  )
})
