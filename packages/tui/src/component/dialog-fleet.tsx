import { createMemo, createResource, onCleanup, onMount } from "solid-js"
import path from "path"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { Locale } from "../util/locale"
import { Spinner } from "./spinner"

// FORK-SEAM: fork-fleet-tui (sessions of every directory with their live status, from the fork API)
export function DialogFleet() {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  const [fleet, { refetch }] = createResource(async () => (await sdk.client.fork.sessions({ roots: "true" })).data ?? [])
  const timer = setInterval(() => void refetch(), 3000)
  onCleanup(() => clearInterval(timer))
  onMount(() => dialog.setSize("large"))

  const options = createMemo(() =>
    (fleet() ?? []).map((entry) => {
      const running = entry.status !== "idle"
      return {
        title: entry.waiting > 0 ? `${entry.session.title} (${entry.waiting} waiting)` : entry.session.title,
        value: entry.session.id,
        category: entry.waiting > 0 ? "Waiting on you" : running ? "Running" : "Recent",
        footer: Locale.truncate(
          `${entry.session.project?.name ?? path.basename(entry.session.project?.worktree ?? "")} ${path.basename(entry.session.directory)}`.trim(),
          28,
        ),
        gutter: running ? () => <Spinner /> : undefined,
        bg: entry.waiting > 0 ? theme.warning : undefined,
      }
    }),
  )

  return (
    <DialogSelect
      title="Sessions in all directories"
      options={options()}
      preserveSelection={true}
      onSelect={(option) => {
        const session = fleet()?.find((entry) => entry.session.id === option.value)?.session
        if (!session) return
        // The TUI is bound to one directory (new prompts would run there), so another directory needs its own client.
        if (session.directory !== sdk.directory) {
          toast.show({
            variant: "info",
            title: "Other directory",
            message: `cd ${session.directory} && syacode -s ${session.id}`,
          })
          return
        }
        route.navigate({ type: "session", sessionID: session.id })
        dialog.clear()
      }}
    />
  )
}
