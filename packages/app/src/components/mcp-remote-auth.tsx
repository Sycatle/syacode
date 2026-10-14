import { onCleanup, onMount, createSignal } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { parseMcpRedirect, setMcpRemoteAuthHandler, type McpRemoteAuthRequest } from "@/utils/mcp-remote-auth"

function McpRemoteAuthDialog(props: { request: McpRemoteAuthRequest; done: () => void }) {
  const language = useLanguage()
  const [value, setValue] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await props.request.complete(parseMcpRedirect(value(), props.request.oauthState))
      props.done()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title={language.t("mcp.remoteAuth.title", { name: props.request.name })}>
      <div class="flex flex-col gap-4 px-6 pb-6">
        <p class="text-14-regular text-text-base">{language.t("mcp.remoteAuth.step1")}</p>
        <Button variant="secondary" onClick={() => window.open(props.request.authorizationUrl, "_blank", "noopener")}>
          {language.t("mcp.remoteAuth.open")}
        </Button>
        <p class="text-14-regular text-text-base">{language.t("mcp.remoteAuth.step2")}</p>
        <TextField
          label={language.t("mcp.remoteAuth.field")}
          placeholder="http://127.0.0.1:…/callback?code=…"
          value={value()}
          onChange={setValue}
          validationState={error() ? "invalid" : undefined}
          error={error()}
        />
        <Button variant="primary" disabled={busy() || !value().trim()} onClick={() => void submit()}>
          {language.t("common.continue")}
        </Button>
      </div>
    </Dialog>
  )
}

export function McpRemoteAuthHost() {
  const dialog = useDialog()
  onMount(() => {
    setMcpRemoteAuthHandler(
      (request) =>
        new Promise<void>((resolve) => {
          const finish = () => {
            dialog.close()
            resolve()
          }
          dialog.show(() => <McpRemoteAuthDialog request={request} done={finish} />, resolve)
        }),
    )
    onCleanup(() => setMcpRemoteAuthHandler(undefined))
  })
  return null
}
