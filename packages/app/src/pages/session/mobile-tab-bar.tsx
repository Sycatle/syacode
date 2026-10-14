import { Icon } from "@opencode-ai/ui/icon"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, type ComponentProps, createSignal, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { MobileView } from "@/context/layout-tabs"
import "./mobile-tab-bar.css"

const KEYBOARD_MIN_HEIGHT = 150

export function MobileTabBar(props: {
  view: Accessor<MobileView>
  terminalOpen: Accessor<boolean>
  changes: Accessor<number>
  activity: Accessor<{ working: number; waiting: number }>
  onView: (view: MobileView) => void
  onTerminal: () => void
  onSessions: () => void
}) {
  const language = useLanguage()
  const active = () => props.activity().working + props.activity().waiting
  const [keyboard, setKeyboard] = createSignal(false)

  // The on-screen keyboard shrinks the visual viewport; the bar would only eat the space left above it.
  onMount(() => {
    const port = window.visualViewport
    if (!port) return
    const sync = () => setKeyboard(window.innerHeight - port.height > KEYBOARD_MIN_HEIGHT)
    makeEventListener(port, "resize", sync)
    sync()
  })

  return (
    <nav
      data-component="mobile-tab-bar"
      aria-label={language.t("session.mobile.navigation")}
      class="shrink-0 border-t border-border-weak-base bg-background-base pb-[env(safe-area-inset-bottom)]"
      classList={{ flex: !keyboard(), hidden: keyboard() }}
    >
      <TabButton
        icon="bullet-list"
        label={language.t("session.mobile.list")}
        ariaLabel={
          active() > 0
            ? language.t("session.mobile.sessions.badge", { count: active() })
            : language.t("session.mobile.sessions")
        }
        badge={active()}
        warning={props.activity().waiting > 0}
        onClick={props.onSessions}
      />
      <TabButton
        icon="bubble-5"
        label={language.t("session.tab.session")}
        selected={props.view() === "session"}
        onClick={() => props.onView("session")}
      />
      <TabButton
        icon="review"
        label={language.t("session.review.change.other")}
        selected={props.view() === "changes"}
        badge={props.changes()}
        onClick={() => props.onView("changes")}
      />
      <TabButton
        icon="file-tree"
        label={language.t("session.mobile.files")}
        selected={props.view() === "files"}
        onClick={() => props.onView("files")}
      />
      <TabButton
        icon="terminal"
        label={language.t("terminal.title")}
        selected={props.terminalOpen()}
        onClick={props.onTerminal}
      />
    </nav>
  )
}

function TabButton(props: {
  icon: ComponentProps<typeof Icon>["name"]
  label: string
  ariaLabel?: string
  selected?: boolean
  badge?: number
  warning?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      aria-current={props.selected ? "page" : undefined}
      data-selected={props.selected ? "" : undefined}
      class="relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-text-base"
      onClick={props.onClick}
    >
      <span class="relative">
        <Icon name={props.icon} />
        <Show when={props.badge}>
          {(count) => (
            <span data-slot="badge" data-tone={props.warning ? "warning" : undefined} aria-hidden="true">
              {count() > 99 ? "99+" : count()}
            </span>
          )}
        </Show>
      </span>
      <span class="max-w-full truncate text-12-regular">{props.label}</span>
    </button>
  )
}
