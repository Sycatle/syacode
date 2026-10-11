import { expect, test } from "bun:test"
import { SessionSummary } from "../../src/session/summary"

test("slim keeps the counts but drops oversized and secret patches", () => {
  const big = "x".repeat(200_001)
  const diffs = [
    { file: "src/a.ts", patch: "@@ small @@", additions: 1, deletions: 0 },
    { file: "package-lock.json", patch: big, additions: 9000, deletions: 0 },
    { file: ".env.prod", patch: "+SECRET=1", additions: 1, deletions: 0 },
    { file: "infra/.env.prod.enc", patch: "+ciphertext", additions: 1, deletions: 0 },
    { file: "certs/server.pem", patch: "+key", additions: 1, deletions: 0 },
  ]
  const out = SessionSummary.slim(diffs)
  expect(out[0]).toBe(diffs[0])
  expect(out.slice(1).map((item) => item.patch)).toEqual([undefined, undefined, undefined, undefined])
  expect(out[1].additions).toBe(9000)
})
