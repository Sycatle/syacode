import { afterEach, expect, test } from "bun:test"
import { ForkSystemPrompt } from "../src/system-prompt"

afterEach(() => {
  delete process.env.OPENCODE_FORK_CADRAGE
  delete process.env.OPENCODE_FORK_BACKLOG
})

test("the Claude prompt frames decisions and continues from the backlog by default", () => {
  const prompt = ForkSystemPrompt.claude(true)
  expect(prompt).toContain("# Framing decisions")
  expect(prompt).toContain("3 to 4 per AskUserQuestion call")
  expect(prompt).toContain("docs/backlog.md")
  expect(prompt).not.toContain("only when a decision is genuinely the user's")
})

test("OPENCODE_FORK_CADRAGE=0 restores the ask-sparingly rule", () => {
  process.env.OPENCODE_FORK_CADRAGE = "0"
  const prompt = ForkSystemPrompt.claude(true)
  expect(prompt).not.toContain("# Framing decisions")
  expect(prompt).toContain("only when a decision is genuinely the user's")
})

test("OPENCODE_FORK_BACKLOG=0 drops the continuity block", () => {
  process.env.OPENCODE_FORK_BACKLOG = "0"
  expect(ForkSystemPrompt.claude(true)).not.toContain("# Continuity")
})
