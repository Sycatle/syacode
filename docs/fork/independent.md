# Independent fork

The fork no longer merges `upstream/dev`. Its mainline is the V1 line (`packages/opencode`), the last runtime that carries every fork feature (quota, permission modes, auto mode, hooks, sandbox, mobile web UI).

- `upstream` stays fetch-only (push URL is `no_push`). Read it to cherry-pick a fix by hand; do not run `script/fork-sync.sh`.
- The V2 port attempt (hooks, sandbox, log fixes on `packages/core`) is kept at tag `v2-upstream-archive`.
- `FORK-SEAM` markers still locate the fork's hooks into shared code (`docs/fork/seams.md`); keep them.
