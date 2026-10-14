import { describe, expect, test } from "bun:test"
import { FIVE_HOUR, quotaPace, quotaRemaining, SEVEN_DAY } from "./quota"

const now = 1_000_000_000_000

describe("quotaPace", () => {
  test("marks the share of the window already elapsed", () => {
    const pace = quotaPace({ utilization: 0.1, reset: now + FIVE_HOUR / 2, status: "allowed" }, FIVE_HOUR, now)
    expect(pace.elapsed).toBe(0.5)
    expect(pace.level).toBe("ok")
  })

  test("warns when usage runs ahead of the clock", () => {
    // Half of the window gone: 40% used is under the pace, 75% is 1.5x over it.
    const window = { utilization: 0.4, reset: now + SEVEN_DAY / 2, status: "allowed" }
    expect(quotaPace(window, SEVEN_DAY, now).level).toBe("ok")
    expect(quotaPace({ ...window, utilization: 0.75 }, SEVEN_DAY, now).level).toBe("warning")
    // A quarter gone: 50% used is twice the pace.
    expect(quotaPace({ ...window, utilization: 0.5, reset: now + SEVEN_DAY * 0.75 }, SEVEN_DAY, now).level).toBe(
      "error",
    )
  })

  test("ignores the pace at the start of a window", () => {
    const window = { utilization: 0.2, reset: now + FIVE_HOUR * 0.95, status: "allowed" }
    expect(quotaPace(window, FIVE_HOUR, now).level).toBe("ok")
  })

  test("a rejected or nearly spent window is an error", () => {
    const window = { utilization: 0.1, reset: now + FIVE_HOUR / 2, status: "rejected" }
    expect(quotaPace(window, FIVE_HOUR, now).level).toBe("error")
    expect(quotaPace({ ...window, status: "allowed", utilization: 0.9 }, FIVE_HOUR, now).level).toBe("error")
  })

  test("clamps a reset in the past or too far away", () => {
    expect(quotaPace({ utilization: 0, reset: now - 1, status: "allowed" }, FIVE_HOUR, now).elapsed).toBe(1)
    expect(quotaPace({ utilization: 0, reset: now + FIVE_HOUR * 2, status: "allowed" }, FIVE_HOUR, now).elapsed).toBe(0)
  })
})

describe("quotaRemaining", () => {
  test("picks the unit by magnitude", () => {
    expect(quotaRemaining(now + 59 * 60_000, now)).toEqual({ unit: "minutes", minutes: 59 })
    expect(quotaRemaining(now + 192 * 60_000, now)).toEqual({ unit: "hours", hours: 3, minutes: 12 })
    expect(quotaRemaining(now + (4 * 1440 + 5 * 60) * 60_000, now)).toEqual({ unit: "days", days: 4, hours: 5 })
  })

  test("never goes negative", () => {
    expect(quotaRemaining(now - 5000, now)).toEqual({ unit: "minutes", minutes: 0 })
  })
})
