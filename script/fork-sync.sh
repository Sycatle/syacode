#!/usr/bin/env bash
# Merge upstream dev into the fork, then verify. Stops on the first failure;
# on merge conflict, resolve (see docs/fork/seams.md) and rerun with --no-merge.
set -euo pipefail
cd "$(dirname "$0")/.."

# The fork is independent (docs/fork/independent.md): merging upstream is opt-in.
if [[ "${1:-}" != "--no-merge" && "${FORK_ALLOW_UPSTREAM:-}" != "1" ]]; then
  echo "fork-sync: upstream is no longer merged. Use --no-merge to only verify, or FORK_ALLOW_UPSTREAM=1 to merge." >&2
  exit 1
fi

if [[ "${1:-}" != "--no-merge" ]]; then
  git fetch upstream dev
  git merge --no-edit upstream/dev
fi

bun install
grep -rn "FORK-SEAM" packages/ --include=*.ts --include=*.tsx
(cd packages/fork && bun run typecheck && bun run test)
(cd packages/opencode && bun run typecheck)
(cd packages/tui && bun run typecheck && bun test --timeout 60000 test/feature-plugins/fork-usage.test.tsx test/feature-plugins/fork-compaction.test.tsx)
echo "Sync OK. Run the bench before shipping: (cd packages/fork && bun run bench --model <provider/model>)"
