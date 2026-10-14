import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import "./connection-banner.css"

// Short drops (an event stream re-subscribing, a tab waking up) resolve themselves; only surface a lasting outage.
const SHOW_AFTER_MS = 1500

export function ConnectionBanner() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [visible, setVisible] = createSignal(false)
  const lost = () => serverSDK().connection() !== "connected"

  createEffect(() => {
    if (!lost()) return setVisible(false)
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <Show when={visible()}>
      <div data-component="connection-banner" role="status" aria-live="polite">
        <Spinner />
        <span>{language.t("session.connection.reconnecting")}</span>
      </div>
    </Show>
  )
}
