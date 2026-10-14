import { getFilename } from "@opencode-ai/core/util/path"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { type Accessor, createMemo, For, Show } from "solid-js"
import FileTree from "@/components/file-tree"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { FileTabContent } from "@/pages/session/file-tabs"
import { useSessionLayout } from "@/pages/session/session-layout"

/** Phone replacement for the side panel: open files as a list, the project tree, and one file read full screen. */
export function MobileFiles(props: { changed: Accessor<readonly string[]> }) {
  const file = useFile()
  const language = useLanguage()
  const { tabs, view } = useSessionLayout()

  const current = createMemo(() => view().mobile.file())
  const opened = createMemo(() =>
    tabs()
      .all()
      .flatMap((tab) => {
        const path = file.pathFromTab(tab)
        return path ? [{ tab, path }] : []
      }),
  )

  const show = (path: string) => {
    const tab = file.tab(path)
    void tabs().open(tab)
    tabs().setActive(tab)
    void file.load(path)
    view().mobile.setFile(tab)
  }

  return (
    <Show
      when={current()}
      fallback={
        <div class="h-full overflow-y-auto overscroll-contain bg-background-stronger px-3 pb-6">
          <Show when={opened().length > 0}>
            <div class="flex flex-col pt-2">
              <For each={opened()}>
                {(item) => (
                  <div class="flex min-h-11 items-center rounded-md hover:bg-surface-raised-base-hover">
                    <button
                      type="button"
                      class="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2 text-start"
                      onClick={() => show(item.path)}
                    >
                      <Icon name="open-file" class="size-5 shrink-0 text-icon-base" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-14-regular text-text-strong">{getFilename(item.path)}</span>
                        <span class="block truncate text-12-regular text-text-weak">{item.path}</span>
                      </span>
                    </button>
                    <IconButton
                      icon="close-small"
                      variant="ghost"
                      class="size-11 shrink-0"
                      aria-label={language.t("common.close")}
                      onClick={() => tabs().close(item.tab)}
                    />
                  </div>
                )}
              </For>
            </div>
            <div class="my-2 border-t border-border-weaker-base" />
          </Show>
          <FileTree
            path=""
            class="pt-2"
            nodeClass="min-h-11"
            modified={props.changed()}
            draggable={false}
            onFileClick={(node) => show(node.path)}
          />
        </div>
      }
    >
      {(tab) => (
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border-weaker-base pe-3">
            <button
              type="button"
              class="flex h-11 shrink-0 items-center gap-1 ps-2 pe-3 text-14-regular text-text-strong"
              onClick={() => view().mobile.setFile(undefined)}
            >
              <Icon name="chevron-left" />
              {language.t("session.mobile.files.back")}
            </button>
            <span class="min-w-0 flex-1 truncate text-end text-12-regular text-text-weak">
              {getFilename(file.pathFromTab(tab()) ?? "")}
            </span>
          </div>
          <div class="min-h-0 flex-1">
            <Tabs value={tab()} class="h-full">
              <FileTabContent tab={tab()} />
            </Tabs>
          </div>
        </div>
      )}
    </Show>
  )
}
