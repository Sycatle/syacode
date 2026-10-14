import { describe, expect, test } from "bun:test"
import { parseMcpRedirect } from "./mcp-remote-auth"

const redirect = (params: Record<string, string>) =>
  `http://127.0.0.1:19876/mcp/oauth/callback?${new URLSearchParams(params)}`

describe("parseMcpRedirect", () => {
  test("returns the code of the matching attempt", () => {
    expect(parseMcpRedirect(` ${redirect({ code: "abc", state: "s1" })} `, "s1")).toBe("abc")
  })

  test("rejects another attempt, an authorization error, a missing code and plain text", () => {
    expect(() => parseMcpRedirect(redirect({ code: "abc", state: "other" }), "s1")).toThrow("different login")
    expect(() => parseMcpRedirect(redirect({ error: "access_denied", state: "s1" }), "s1")).toThrow("access_denied")
    expect(() => parseMcpRedirect(redirect({ state: "s1" }), "s1")).toThrow("no authorization code")
    expect(() => parseMcpRedirect("abc", "s1")).toThrow("full address")
  })
})
