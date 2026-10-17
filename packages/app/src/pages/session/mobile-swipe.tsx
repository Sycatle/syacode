import { type Accessor, createSignal, Show } from "solid-js"
import { scrollsHorizontally, swipeDirection } from "./mobile-tabs"

const POSITION_VISIBLE_MS = 1400

// Module scoped: the new layout remounts the session page on every navigation, so the indicator
// has to outlive the page that started the swipe.
const [shown, setShown] = createSignal(false)
let hide: ReturnType<typeof setTimeout> | undefined

export function createSessionSwipe(input: { enabled: Accessor<boolean>; onStep: (direction: 1 | -1) => void }) {
  let start: { x: number; y: number; at: number } | undefined

  return {
    onTouchStart(event: TouchEvent & { currentTarget: HTMLElement }) {
      const touch = event.touches[0]
      const claimed =
        !input.enabled() ||
        event.touches.length !== 1 ||
        !touch ||
        scrollsHorizontally(event.target, event.currentTarget)
      start = claimed ? undefined : { x: touch.clientX, y: touch.clientY, at: Date.now() }
    },
    onTouchEnd(event: TouchEvent) {
      const origin = start
      start = undefined
      const touch = event.changedTouches[0]
      if (!origin || !touch) return
      // Dragging a text selection handle is not a navigation gesture.
      if (window.getSelection()?.toString()) return
      const direction = swipeDirection({
        startX: origin.x,
        dx: touch.clientX - origin.x,
        dy: touch.clientY - origin.y,
        ms: Date.now() - origin.at,
        width: window.innerWidth,
      })
      if (!direction) return
      setShown(true)
      clearTimeout(hide)
      hide = setTimeout(() => setShown(false), POSITION_VISIBLE_MS)
      input.onStep(direction)
    },
  }
}

export function SessionPosition(props: {
  position: Accessor<{ index: number; total: number } | undefined>
  class: string
}) {
  return (
    <Show when={shown() ? props.position() : undefined}>
      {(position) => (
        <div
          role="status"
          class={`pointer-events-none start-1/2 z-10 -translate-x-1/2 rounded-full border border-border-weak-base bg-background-stronger px-3 py-1 text-12-regular text-text-strong ${props.class}`}
        >
          {position().index} / {position().total}
        </div>
      )}
    </Show>
  )
}
