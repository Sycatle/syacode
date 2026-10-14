export type McpRemoteAuthRequest = {
  name: string
  authorizationUrl: string
  oauthState: string
  complete: (code: string) => Promise<unknown>
}

let handler: ((request: McpRemoteAuthRequest) => Promise<void>) | undefined

/** The dialog host registers itself here so state code, which cannot render, can ask the user to finish a login. */
export function setMcpRemoteAuthHandler(next: typeof handler) {
  handler = next
}

export function requestMcpRemoteAuth(request: McpRemoteAuthRequest) {
  if (!handler) throw new Error("MCP authorization needs a browser on the same machine as the server")
  return handler(request)
}

/** Pulls the authorization code out of the address the browser ended on after the user approved access. */
export function parseMcpRedirect(value: string, oauthState: string) {
  const url = URL.canParse(value.trim()) ? new URL(value.trim()) : undefined
  if (!url) throw new Error("Paste the full address shown in the browser after approving access")
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
  if (error) throw new Error(error)
  if (url.searchParams.get("state") !== oauthState) throw new Error("This address belongs to a different login attempt")
  const code = url.searchParams.get("code")
  if (!code) throw new Error("The address has no authorization code")
  return code
}
