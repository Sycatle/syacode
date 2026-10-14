import { For } from "solid-js"
import { useLanguage } from "@/context/language"
import { terminalKeys } from "@/utils/terminal-keys"

export function TerminalKeys(props: { ctrl: boolean; onCtrl: () => void; onKey: (data: string) => void }) {
  const language = useLanguage()
  // Keep the focus on the terminal's input so pressing a key does not dismiss the on-screen keyboard.
  const keepFocus = (event: MouseEvent) => event.preventDefault()
  const button =
    "min-h-11 min-w-11 shrink-0 rounded-md px-3 text-14-regular text-text-strong active:bg-surface-base-active"

  return (
    <div
      role="toolbar"
      aria-label={language.t("terminal.keys")}
      data-component="terminal-keys"
      class="flex shrink-0 gap-1 overflow-x-auto border-t border-border-weak-base bg-background-base px-2 py-1"
    >
      <button
        type="button"
        aria-pressed={props.ctrl}
        class={button}
        classList={{ "bg-surface-base-active": props.ctrl }}
        onMouseDown={keepFocus}
        onClick={props.onCtrl}
      >
        Ctrl
      </button>
      <For each={terminalKeys}>
        {(key) => (
          <button type="button" class={button} onMouseDown={keepFocus} onClick={() => props.onKey(key.data)}>
            {key.label}
          </button>
        )}
      </For>
    </div>
  )
}
