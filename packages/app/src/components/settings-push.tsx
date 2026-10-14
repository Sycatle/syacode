import { Component, createResource, createSignal, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { disablePush, enablePush, pushSubscription, pushSupported } from "@/utils/push"
import { showToast } from "@/utils/toast"
import { SettingsRow } from "./settings-row"

// iOS only exposes Web Push to an app added to the Home Screen.
const needsInstall = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches

export const PushSetting: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [subscribed, { mutate }] = createResource(async () => !!(await pushSubscription()))
  const [pending, setPending] = createSignal(false)

  const target = () => {
    const server = serverSDK().server
    return server.type === "http" ? { http: server.http, fetch: platform.fetch } : undefined
  }

  const change = async (checked: boolean) => {
    const current = target()
    if (!current) return
    setPending(true)
    try {
      if (checked) {
        const enabled = await enablePush(current)
        if (!enabled) showToast({ variant: "error", title: language.t("settings.notifications.push.denied") })
        mutate(enabled)
        return
      }
      await disablePush(current)
      mutate(false)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.notifications.push.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Show when={target() && (pushSupported() || needsInstall())}>
      <SettingsRow
        title={language.t("settings.notifications.push.title")}
        description={language.t(
          needsInstall() ? "settings.notifications.push.install" : "settings.notifications.push.description",
        )}
      >
        <div data-action="settings-notifications-push">
          <Switch
            checked={subscribed() === true}
            disabled={pending() || needsInstall() || subscribed.loading}
            onChange={(checked) => void change(checked)}
          />
        </div>
      </SettingsRow>
    </Show>
  )
}
