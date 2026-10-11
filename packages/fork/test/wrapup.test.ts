import { expect, test } from "bun:test"
import { ForkWrapup } from "../src/wrapup"

const NOW = 1_000_000
const snapshot = (five: number, seven = 0.1, over: { status?: string; reset?: number } = {}) => ({
  provider: "anthropic",
  status: "allowed",
  time: NOW,
  five_hour: { utilization: five, reset: over.reset ?? NOW + 3_600_000, status: over.status ?? "allowed" },
  seven_day: { utilization: seven, reset: NOW + 86_400_000, status: "allowed" },
})

test("a session closes at the threshold, not before", () => {
  expect(ForkWrapup.quota(snapshot(0.8), NOW, 0.95).state).toBe("ok")
  const state = ForkWrapup.quota(snapshot(0.96), NOW, 0.95)
  expect(state).toMatchObject({ state: "wrap-up", window: "five_hour", reset: NOW + 3_600_000 })
})

test("a rejected window closes whatever its utilization", () => {
  expect(ForkWrapup.quota(snapshot(0.3, 0.1, { status: "rejected" }), NOW, 0.95).state).toBe("wrap-up")
})

test("work resumes when the window that reopens last has reopened", () => {
  const state = ForkWrapup.quota(snapshot(0.97, 0.99), NOW, 0.95)
  expect(state).toMatchObject({ window: "seven_day", reset: NOW + 86_400_000 })
  expect(ForkWrapup.dueAt(NOW + 86_400_000)).toBe(NOW + 86_400_000 + ForkWrapup.RESUME_MARGIN_MS)
})

test("a window already past its reset, or no snapshot, never closes a session", () => {
  expect(ForkWrapup.quota(snapshot(0.99, 0.1, { reset: NOW - 1 }), NOW, 0.95).state).toBe("ok")
  expect(ForkWrapup.quota(undefined, NOW).state).toBe("ok")
})

test("the threshold reads a ratio or a percentage and can be switched off", () => {
  expect(ForkWrapup.quotaThreshold({})).toBe(0.95)
  expect(ForkWrapup.quotaThreshold({ OPENCODE_FORK_WRAPUP_QUOTA: "90" })).toBe(0.9)
  expect(ForkWrapup.quotaThreshold({ OPENCODE_FORK_WRAPUP_QUOTA: "0.8" })).toBe(0.8)
  process.env.OPENCODE_FORK_WRAPUP = "0"
  expect(ForkWrapup.quota(snapshot(0.99), NOW).state).toBe("ok")
  delete process.env.OPENCODE_FORK_WRAPUP
})

test("a window winds down before it closes", () => {
  expect(ForkWrapup.quota(snapshot(0.84), NOW, 0.95).state).toBe("ok")
  expect(ForkWrapup.quota(snapshot(0.86), NOW, 0.95)).toMatchObject({ state: "wind-down", window: "five_hour", used: 0.86 })
  expect(ForkWrapup.quota(snapshot(0.96), NOW, 0.95).state).toBe("wrap-up")
})

test("new work is refused while winding down, and /wrapup is consumed once", () => {
  const state = ForkWrapup.quota(snapshot(0.9), NOW, 0.95)
  if (state.state !== "wind-down") throw new Error("expected wind-down")
  expect(ForkWrapup.refusal("task", state)).toContain("5-hour usage window is at 90%")
  expect(ForkWrapup.consume("ses_1")).toBe(false)
  ForkWrapup.request("ses_1")
  expect(ForkWrapup.consume("ses_1")).toBe(true)
  expect(ForkWrapup.consume("ses_1")).toBe(false)
})
