import { describe, expect, test } from "bun:test"
import { sessionActivity, swipeDirection } from "./mobile-tabs"

describe("swipeDirection", () => {
  const base = { startX: 200, dx: -120, dy: 10, ms: 250, width: 390 }

  test("a left drag goes to the next session and a right drag to the previous one", () => {
    expect(swipeDirection(base)).toBe(1)
    expect(swipeDirection({ ...base, dx: 120 })).toBe(-1)
  })

  test("ignores short, slow, mostly vertical or edge drags", () => {
    expect(swipeDirection({ ...base, dx: -40 })).toBeUndefined()
    expect(swipeDirection({ ...base, ms: 900 })).toBeUndefined()
    expect(swipeDirection({ ...base, dy: 100 })).toBeUndefined()
    expect(swipeDirection({ ...base, startX: 8 })).toBeUndefined()
    expect(swipeDirection({ ...base, startX: 385 })).toBeUndefined()
  })
})

describe("sessionActivity", () => {
  test("counts running and waiting sessions once, skipping idle ones and subagent work", () => {
    const result = sessionActivity({
      status: { a: { type: "busy" }, b: { type: "idle" }, c: { type: "busy" }, child: { type: "busy" } },
      permission: { c: [{}], other: [] },
      question: { q: [{}] },
      isChild: (id) => id === "child",
    })
    expect(result).toEqual({ waiting: 2, working: 1 })
  })
})
