import { describe, expect, it } from "vitest";
import { AgentRunRequestSchema } from "./agent-run.js";

describe("AgentRunRequestSchema — multimodal task + sampling params", () => {
  it("accepts task as a plain string", () => {
    const r = AgentRunRequestSchema.parse({ connectionId: "c1", task: "x" });
    expect(r.task).toBe("x");
  });

  it("accepts task as an array of content parts", () => {
    const r = AgentRunRequestSchema.parse({
      connectionId: "c1",
      task: [
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
      ],
    });
    expect(r.task).toEqual([
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ]);
  });

  it("rejects an empty string task", () => {
    expect(() => AgentRunRequestSchema.parse({ connectionId: "c1", task: "" })).toThrow();
  });

  it("rejects an empty array task", () => {
    expect(() => AgentRunRequestSchema.parse({ connectionId: "c1", task: [] })).toThrow();
  });

  it("accepts params with a subset of sampling fields", () => {
    const r = AgentRunRequestSchema.parse({
      connectionId: "c1",
      task: "x",
      params: { temperature: 0.5 },
    });
    expect(r.params).toEqual({ temperature: 0.5 });
  });

  it("omits tools/tool_choice/stream from the picked params shape", () => {
    const r = AgentRunRequestSchema.parse({
      connectionId: "c1",
      task: "x",
      params: { temperature: 0.5, tools: [], stream: true },
    });
    expect(r.params).not.toHaveProperty("tools");
    expect(r.params).not.toHaveProperty("stream");
  });
});
