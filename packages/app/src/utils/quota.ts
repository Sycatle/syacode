export const FIVE_HOUR = 5 * 3600_000
export const SEVEN_DAY = 7 * 86_400_000

export type QuotaWindow = { utilization: number; reset: number; status: string }

/**
 * How a subscription window is being used against the time left before it resets. `elapsed` is the share of the
 * window already gone, which is where the usage marker sits if it keeps a steady pace. Early in a window (under
 * 10%) the pace is too noisy to judge, so only the absolute thresholds apply.
 */
export function quotaPace(window: QuotaWindow, length: number, now: number) {
  const elapsed = Math.min(1, Math.max(0, 1 - (window.reset - now) / length))
  const ratio = elapsed >= 0.1 ? window.utilization / elapsed : undefined
  const level =
    window.status !== "allowed" ||
    window.utilization >= 0.9 ||
    (ratio !== undefined && window.utilization >= 0.5 && ratio >= 2)
      ? ("error" as const)
      : window.utilization >= 0.8 || (ratio !== undefined && window.utilization >= 0.3 && ratio >= 1.5)
        ? ("warning" as const)
        : ("ok" as const)
  return { elapsed, level }
}

/** Time left before a reset, split into the units the locale strings render. */
export function quotaRemaining(reset: number, now: number) {
  const minutes = Math.max(0, Math.floor((reset - now) / 60_000))
  if (minutes < 60) return { unit: "minutes" as const, minutes }
  if (minutes < 1440) return { unit: "hours" as const, hours: Math.floor(minutes / 60), minutes: minutes % 60 }
  return { unit: "days" as const, days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60) }
}
