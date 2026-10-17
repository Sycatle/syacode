import { describe, expect, test } from "bun:test"
import { ctrlSequence } from "./terminal-keys"

describe("ctrlSequence", () => {
  test("maps letters to control codes whatever their case", () => {
    expect(ctrlSequence("c")).toBe("\x03")
    expect(ctrlSequence("C")).toBe("\x03")
    expect(ctrlSequence("d")).toBe("\x04")
    expect(ctrlSequence("z")).toBe("\x1a")
  })

  test("leaves input without a control form alone", () => {
    expect(ctrlSequence("1")).toBeUndefined()
    expect(ctrlSequence(" ")).toBeUndefined()
    expect(ctrlSequence("\x1b[A")).toBeUndefined()
    expect(ctrlSequence("")).toBeUndefined()
  })
})
