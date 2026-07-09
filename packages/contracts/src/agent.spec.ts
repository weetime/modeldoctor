import { describe, expect, it } from "vitest";
import { AgentSseEventSchema } from "./agent.js";

describe("AgentSseEventSchema — unified playground stream events", () => {
  it("parses a text_delta event", () => {
    const r = AgentSseEventSchema.parse({ type: "text_delta", delta: "hi" });
    expect(r).toEqual({ type: "text_delta", delta: "hi" });
  });

  it("parses an assistant_end event", () => {
    const r = AgentSseEventSchema.parse({ type: "assistant_end" });
    expect(r).toEqual({ type: "assistant_end" });
  });
});
