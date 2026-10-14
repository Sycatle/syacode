// Keys a phone keyboard lacks. `data` is what a hardware keyboard would send to the PTY.
export const terminalKeys = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "←", data: "\x1b[D" },
  { label: "↓", data: "\x1b[B" },
  { label: "↑", data: "\x1b[A" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
] as const

// Control-modified form of one typed character (Ctrl+C is 0x03), or undefined when it has none.
export function ctrlSequence(data: string) {
  if (data.length !== 1) return undefined
  const code = data.toUpperCase().charCodeAt(0)
  if (code < 0x40 || code > 0x5f) return undefined
  return String.fromCharCode(code & 0x1f)
}
