import { Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"

// A server restart closes the tool calls it cut short as errors flagged `interrupted`. Once the session is idle,
// the only way back is a new message, so offer it as one tap.
export function SessionInterruptedNotice(props: { sessionID: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()

  const interrupted = createMemo(() => {
    const data = sync().data
    if ((data.session_status[props.sessionID]?.type ?? "idle") !== "idle") return false
    const last = data.message[props.sessionID]?.at(-1)
    if (last?.role !== "assistant") return false
    return (data.part[last.id] ?? []).some(
      (part) => part.type === "tool" && part.state.status === "error" && part.state.metadata?.interrupted === true,
    )
  })

  const resume = () =>
    sdk()
      .api.session.prompt({ sessionID: props.sessionID, text: language.t("session.interrupted.prompt") })
      .catch(() => showToast({ variant: "error", title: language.t("common.requestFailed") }))

  return (
    <Show when={interrupted()}>
      <div data-component="session-interrupted" role="status" class="flex items-center gap-3 pb-2">
        <span class="min-w-0 flex-1 text-13-regular text-text-weak">{language.t("session.interrupted.notice")}</span>
        <Button size="normal" variant="secondary" onClick={() => void resume()}>
          {language.t("session.interrupted.action")}
        </Button>
      </div>
    </Show>
  )
}
