import type { ForkUsage } from "@opencode-ai/sdk/v2/client"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { FIVE_HOUR, quotaPace, quotaRemaining, SEVEN_DAY } from "@/utils/quota"

type Level = "ok" | "warning" | "error"

const PROVIDERS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" }
const CLOCK_MS = 30_000

const fill: Record<Level, string> = {
  ok: "bg-icon-strong-base",
  warning: "bg-icon-warning-base",
  error: "bg-icon-critical-base",
}

const figure: Record<Level, string> = {
  ok: "text-text-weak",
  warning: "text-icon-warning-base",
  error: "text-icon-critical-base",
}

/**
 * The 5-hour and weekly windows of the subscription the session runs on (Claude or ChatGPT). Each bar carries a
 * marker where usage would sit if it kept a steady pace, and turns amber then red when it runs ahead of it.
 * `compact` is a single row for the composer; `detailed` adds the provider, the reset countdown and the legend.
 */
export function QuotaBars(props: { quota: NonNullable<ForkUsage["quota"]>; variant: "compact" | "detailed" }) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), CLOCK_MS)
  onCleanup(() => clearInterval(clock))

  const percent = (value: number) =>
    new Intl.NumberFormat(language.intl(), { style: "percent", maximumFractionDigits: 0 }).format(value)

  const remaining = (reset: number) => {
    const left = quotaRemaining(reset, now())
    if (left.unit === "minutes") return language.t("session.quota.remaining.minutes", { minutes: left.minutes })
    if (left.unit === "hours")
      return language.t("session.quota.remaining.hours", {
        hours: left.hours,
        minutes: String(left.minutes).padStart(2, "0"),
      })
    return language.t("session.quota.remaining.days", { days: left.days, hours: left.hours })
  }

  const windows = createMemo(() =>
    [
      { label: language.t("session.quota.fiveHour"), length: FIVE_HOUR, window: props.quota.fiveHour },
      { label: language.t("session.quota.sevenDay"), length: SEVEN_DAY, window: props.quota.sevenDay },
    ].flatMap((item) =>
      item.window ? [{ label: item.label, window: item.window, pace: quotaPace(item.window, item.length, now()) }] : [],
    ),
  )

  return (
    <Show when={windows().length > 0}>
      <div
        data-component="session-quota"
        data-variant={props.variant}
        role="group"
        aria-label={language.t("session.quota.title")}
        classList={{
          "flex items-center gap-4 pb-2 text-12-regular text-text-weak": props.variant === "compact",
          "flex flex-col gap-3 text-12-regular text-text-weak": props.variant === "detailed",
        }}
      >
        <Show when={props.variant === "detailed"}>
          <div>
            {language.t("session.quota.title")} · {PROVIDERS[props.quota.provider] ?? props.quota.provider}
          </div>
        </Show>
        <For each={windows()}>
          {(item) => (
            <div
              title={language.t("session.quota.resetIn", { time: remaining(item.window.reset) })}
              classList={{
                "flex min-w-0 flex-1 items-center gap-2": props.variant === "compact",
                "flex flex-col gap-1": props.variant === "detailed",
              }}
            >
              <div class="flex min-w-0 items-center gap-2" classList={{ "flex-1": props.variant === "compact" }}>
                <span class="shrink-0 text-text-strong">{item.label}</span>
                <div
                  role="progressbar"
                  aria-label={language.t("session.quota.usage", {
                    window: item.label,
                    percent: percent(item.window.utilization),
                  })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(item.window.utilization * 100)}
                  class="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-border-weak-base"
                >
                  <div
                    class="h-full rounded-full"
                    classList={{ [fill[item.pace.level]]: true }}
                    style={{ width: `${Math.min(1, item.window.utilization) * 100}%` }}
                  />
                  <div
                    aria-hidden="true"
                    class="absolute inset-y-0 w-px bg-text-weak"
                    style={{ "inset-inline-start": `${item.pace.elapsed * 100}%` }}
                  />
                </div>
                <span class="shrink-0 tabular-nums" classList={{ [figure[item.pace.level]]: true }}>
                  {percent(item.window.utilization)}
                </span>
              </div>
              <Show when={props.variant === "detailed"}>
                <div>{language.t("session.quota.resetIn", { time: remaining(item.window.reset) })}</div>
              </Show>
            </div>
          )}
        </For>
        <Show when={props.variant === "detailed"}>
          <div>{language.t("session.quota.pace")}</div>
        </Show>
      </div>
    </Show>
  )
}
