import { getFilename } from "@opencode-ai/core/util/path"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"
import { sessionTitle } from "@/utils/session-title"
import { useSessionActivity } from "./sidebar-items"

const SESSION_LIMIT = 40

// Commands registered by the session page; the ones it does not offer for the current session are left out.
const ACTIONS = [
  { id: "session.rename", label: "common.rename" },
  { id: "session.share" },
  { id: "session.unshare" },
  { id: "session.export", label: "common.export" },
  { id: "session.archive", label: "common.archive" },
  { id: "session.delete", label: "common.delete" },
] as const

export type SheetSession = { id: string; title?: string; directory: string }

export function MobileSessionSheet(props: {
  sessions: Accessor<SheetSession[]>
  activeID: Accessor<string | undefined>
  onSelect: (session: SheetSession) => void
  onNew: () => void
  onClose?: (session: SheetSession) => void
}) {
  const layout = useLayout()
  const language = useLanguage()
  const serverSync = useServerSync()
  const command = useCommand()
  const close = () => layout.sessionSheet.hide()

  const actions = createMemo(() => {
    if (!props.activeID()) return []
    return ACTIONS.flatMap((action) => {
      const option = command.options.find((item) => item.id === action.id)
      if (!option || option.disabled) return []
      return [{ id: action.id, label: "label" in action ? language.t(action.label) : option.title }]
    })
  })

  // Sessions waiting on the user come first; the rest keep the caller's order, which is also the swipe order.
  const sorted = createMemo(() => {
    const data = serverSync().session.data
    const waiting = (id: string) => (data.permission[id]?.length ?? 0) + (data.question[id]?.length ?? 0) > 0
    return props
      .sessions()
      .slice()
      .sort((a, b) => Number(waiting(b.id)) - Number(waiting(a.id)))
      .slice(0, SESSION_LIMIT)
  })
  const showDirectory = createMemo(() => new Set(props.sessions().map((session) => session.directory)).size > 1)

  createEffect(() => {
    if (!layout.sessionSheet.opened()) return
    makeEventListener(window, "keydown", (event) => {
      if (event.key === "Escape") close()
    })
  })

  return (
    <Show when={layout.sessionSheet.opened()}>
      <div
        class="fixed inset-0 z-50 flex items-end bg-black/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={language.t("session.mobile.sessions")}
          class="flex max-h-[75dvh] w-full flex-col rounded-t-xl border-t border-border-weak-base bg-background-base pb-[env(safe-area-inset-bottom)]"
        >
          <div class="flex h-12 shrink-0 items-center justify-between ps-4 pe-1">
            <span class="text-14-medium text-text-strong">{language.t("session.mobile.sessions")}</span>
            <IconButton
              icon="close"
              variant="ghost"
              class="size-11"
              aria-label={language.t("common.close")}
              onClick={close}
            />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-surface-raised-base-hover"
              onClick={() => {
                close()
                props.onNew()
              }}
            >
              <Icon name="new-session" class="size-6 shrink-0 text-icon-base" />
              <span class="text-14-regular text-text-strong">{language.t("command.session.new")}</span>
            </button>
            <For each={sorted()}>
              {(session) => (
                <SheetRow
                  session={session}
                  active={props.activeID() === session.id}
                  showDirectory={showDirectory()}
                  onSelect={() => {
                    close()
                    props.onSelect(session)
                  }}
                  onClose={props.onClose ? () => props.onClose?.(session) : undefined}
                />
              )}
            </For>
            <Show when={sorted().length === 0}>
              <div class="px-3 py-6 text-center text-14-regular text-text-weak">
                {language.t("session.mobile.sessions.empty")}
              </div>
            </Show>
          </div>
          <Show when={actions().length > 0}>
            <div class="flex shrink-0 flex-wrap gap-2 border-t border-border-weak-base px-3 py-2">
              <For each={actions()}>
                {(action) => (
                  <button
                    type="button"
                    class="min-h-11 rounded-md bg-surface-raised-base px-3 text-14-regular text-text-strong hover:bg-surface-raised-base-hover"
                    onClick={() => {
                      close()
                      command.trigger(action.id)
                    }}
                  >
                    {action.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}

function SheetRow(props: {
  session: SheetSession
  active: boolean
  showDirectory: boolean
  onSelect: () => void
  onClose?: () => void
}) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const activity = useSessionActivity(() => props.session)
  const hasQuestion = createMemo(() => (serverSync().session.data.question[props.session.id]?.length ?? 0) > 0)

  return (
    <div
      class="flex items-center rounded-md hover:bg-surface-raised-base-hover"
      classList={{ "bg-surface-base-active": props.active }}
    >
      <button
        type="button"
        aria-current={props.active ? "true" : undefined}
        class="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start"
        onClick={props.onSelect}
      >
        <div class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
          <Switch>
            <Match when={activity.hasPermissions() || hasQuestion()}>
              <div class="size-2 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={activity.isWorking()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={activity.hasError()}>
              <div class="size-2 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={activity.unseenCount() > 0}>
              <div class="size-2 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-14-regular text-text-strong">
            {sessionTitle(props.session.title) ?? language.t("command.session.new")}
          </div>
          <Show when={props.showDirectory}>
            <div class="truncate text-12-regular text-text-weak">{getFilename(props.session.directory)}</div>
          </Show>
        </div>
      </button>
      <Show when={props.onClose}>
        <IconButton
          icon="close"
          variant="ghost"
          class="size-11 shrink-0"
          aria-label={language.t("common.close")}
          onClick={props.onClose}
        />
      </Show>
    </div>
  )
}
