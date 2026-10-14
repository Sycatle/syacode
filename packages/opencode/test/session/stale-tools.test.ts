import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect } from "effect"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionStaleTools } from "../../src/session/stale-tools"
import { MessageID, PartID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, MessageV2.node, SessionProjector.node])))

it.instance("settles tool calls a dead process left running and keeps finished ones", () =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const created = yield* session.create({})
    const messageID = MessageID.ascending()
    yield* session.updateMessage({
      id: messageID,
      sessionID: created.id,
      role: "assistant",
      time: { created: Date.now() },
      parentID: MessageID.ascending(),
      modelID: "test",
      providerID: "test",
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as never)
    const tool = (callID: string, state: object) =>
      session.updatePart({
        id: PartID.ascending(),
        sessionID: created.id,
        messageID,
        type: "tool",
        callID,
        tool: "bash",
        state,
      } as never)
    yield* tool("running", { status: "running", input: {}, time: { start: 1 } })
    yield* tool("done", { status: "completed", input: {}, output: "ok", title: "t", metadata: {}, time: { start: 1, end: 2 } })

    yield* SessionStaleTools.settle
    const parts = (yield* session.messages({ sessionID: created.id })).flatMap((message) => message.parts)

    expect(parts.find((part) => part.type === "tool" && part.callID === "running")).toMatchObject({
      state: { status: "error", metadata: { interrupted: true }, time: { start: 1 } },
    })
    expect(parts.find((part) => part.type === "tool" && part.callID === "done")).toMatchObject({
      state: { status: "completed" },
    })
  }),
)
