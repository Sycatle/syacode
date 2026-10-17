const SWIPE_MIN_DISTANCE = 80
const SWIPE_MAX_MS = 700
// iOS reserves the screen edges for back/forward navigation.
const SWIPE_EDGE = 24

/**
 * Maps a finished horizontal drag to a neighbouring session: 1 for the next one
 * (finger moved left), -1 for the previous one. Mostly vertical drags are scrolls.
 */
export function swipeDirection(input: { startX: number; dx: number; dy: number; ms: number; width: number }) {
  if (input.ms > SWIPE_MAX_MS) return undefined
  if (input.startX < SWIPE_EDGE || input.startX > input.width - SWIPE_EDGE) return undefined
  if (Math.abs(input.dx) < SWIPE_MIN_DISTANCE) return undefined
  if (Math.abs(input.dx) < Math.abs(input.dy) * 2) return undefined
  return input.dx < 0 ? 1 : -1
}

/** Sessions that need attention right now: waiting on the user, or running. Subagent sessions only count when waiting. */
export function sessionActivity(input: {
  status: Record<string, { type: string }>
  permission: Record<string, readonly unknown[] | undefined>
  question: Record<string, readonly unknown[] | undefined>
  isChild: (id: string) => boolean
}) {
  const waiting = new Set(
    [input.permission, input.question].flatMap((requests) =>
      Object.entries(requests).flatMap(([id, items]) => (items?.length ? [id] : [])),
    ),
  )
  const working = Object.entries(input.status).flatMap(([id, status]) =>
    status.type !== "idle" && !waiting.has(id) && !input.isChild(id) ? [id] : [],
  )
  return { waiting: waiting.size, working: working.length }
}

/** Whether a drag that started on `target` may be a horizontal scroll of the content itself (code blocks, tables). */
export function scrollsHorizontally(target: EventTarget | null, boundary: Element) {
  for (let node = target instanceof Element ? target : null; node && node !== boundary; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth) continue
    const overflow = getComputedStyle(node).overflowX
    if (overflow === "auto" || overflow === "scroll") return true
  }
  return false
}
