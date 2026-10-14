import { createEffect, createMemo, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { tabKey, useTabs } from "@/context/tabs"
import { MobileSessionSheet } from "@/pages/layout/mobile-session-sheet"
import { SessionPosition } from "@/pages/session/mobile-swipe"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const layout = useLayout()
  const server = useServer()
  const serverSync = useServerSync()
  const tabs = useTabs()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  // The phone session sheet lists the same tabs as the title bar strip.
  const sheetSessions = createMemo(() =>
    tabs.store.flatMap((tab) => {
      if (tab.type !== "session" || tab.server !== server.key) return []
      const session = serverSync().session.peek(tab.sessionId)
      const info = tabs.info[tabKey(tab)]
      const directory = session?.directory ?? info?.directory
      return directory ? [{ id: tab.sessionId, title: session?.title ?? info?.title, directory }] : []
    }),
  )
  const activeID = () => {
    const route = layout.route()
    return route.type === "session" ? route.sessionId : undefined
  }

  // The session page remounts on every tab change, so the swipe position lives here.
  const sessionPosition = () => {
    const index = sheetSessions().findIndex((session) => session.id === activeID())
    return index === -1 ? undefined : { index: index + 1, total: sheetSessions().length }
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <SessionPosition position={sessionPosition} class="fixed top-14" />
      <MobileSessionSheet
        sessions={sheetSessions}
        activeID={activeID}
        onSelect={(session) => tabs.select({ type: "session", server: server.key, sessionId: session.id })}
        onNew={() => {
          const directory = serverSync().session.peek(activeID() ?? "")?.directory ?? sheetSessions()[0]?.directory
          if (directory) void tabs.newDraft({ server: server.key, directory })
        }}
        onClose={(session) => {
          const index = tabs.store.findIndex((tab) => tab.type === "session" && tab.sessionId === session.id)
          tabs.closeTab(index)
        }}
      />
      <ToastRegion v2 />
    </div>
  )
}
