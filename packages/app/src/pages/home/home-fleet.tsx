import type { ForkFleetEntry, GlobalSession, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { useQuery } from "@tanstack/solid-query"
import { type Accessor, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { sessionTitle } from "@/utils/session-title"

// FORK-SEAM: fork-fleet-web (sessions running in every directory, from the fork API)
export function HomeFleet(props: {
  client: Accessor<OpencodeClient | undefined>
  server: Accessor<string>
  onOpen: (session: GlobalSession) => void
}) {
  const language = useLanguage()
  const fleet = useQuery(() => ({
    queryKey: ["fork-fleet", props.server()],
    enabled: !!props.client(),
    queryFn: async ({ signal }): Promise<ForkFleetEntry[]> =>
      (await props.client()!.fork.sessions({ active: "true", roots: "true" }, { signal, throwOnError: true })).data ?? [],
    refetchInterval: 5_000,
    retry: false,
  }))

  return (
    <Show when={(fleet.data?.length ?? 0) > 0}>
      <section data-component="home-fleet" class="mb-4 flex flex-col gap-1">
        <h2 class="text-v2-text-text-muted [font-weight:440]">
          {language.t("home.fleet.title", { count: fleet.data!.length })}
        </h2>
        <For each={fleet.data}>
          {(entry) => (
            <button
              type="button"
              class="flex min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-v2-background-bg-layer-02"
              onClick={() => props.onOpen(entry.session)}
            >
              <span
                aria-hidden="true"
                class="size-2 shrink-0 rounded-full bg-v2-background-bg-layer-04"
                classList={{ "animate-pulse": entry.waiting === 0 }}
              />
              <span class="min-w-0 flex-1 truncate">{sessionTitle(entry.session.title)}</span>
              <span class="shrink-0 truncate text-v2-text-text-muted">
                {entry.session.project?.name ?? entry.session.directory.split("/").filter(Boolean).at(-1)}
              </span>
              <Show when={entry.waiting > 0}>
                <span class="shrink-0 rounded-full px-1.5 text-v2-text-text-muted">
                  {language.t("home.fleet.waiting", { count: entry.waiting })}
                </span>
              </Show>
              <Show when={entry.status === "retry"}>
                <span class="shrink-0 text-v2-text-text-muted">{language.t("home.fleet.retry")}</span>
              </Show>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}
