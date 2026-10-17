import { Show } from "solid-js"
import { QuotaBars } from "@/components/session/quota-bars"
import { createForkUsage } from "@/components/session/session-fork-usage"
import { useSync } from "@/context/sync"

// Subscription quota above the prompt, like the TUI status row. It is read when a turn starts or ends, the moments
// the provider reports new utilization; sessions without a subscription (API keys) have no quota and render nothing.
// `latest` keeps the bars in place during a refetch: reading the resource itself would suspend the composer.
export function SessionQuota(props: { sessionID: string }) {
  const sync = useSync()
  const usage = createForkUsage(() => {
    const data = sync().data
    const idle = (data.session_status[props.sessionID]?.type ?? "idle") === "idle"
    return { sessionID: props.sessionID, revision: `${data.message[props.sessionID]?.length ?? 0}:${idle}` }
  })
  return <Show when={usage.latest?.quota}>{(quota) => <QuotaBars quota={quota()} variant="compact" />}</Show>
}
