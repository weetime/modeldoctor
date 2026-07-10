import { describe, expect, it } from "vitest";
import { sidebarGroups } from "./sidebar-config";

describe("sidebarGroups playground group", () => {
  const playground = sidebarGroups.find((g) => g.id === "playground");

  it("exists", () => {
    expect(playground).toBeDefined();
  });

  it("has exactly one conversational entry pointing at the unified /playground/agent page", () => {
    const conversational = playground?.items.filter((item) => item.to === "/playground/agent");
    expect(conversational).toHaveLength(1);
    expect(conversational?.[0].labelKey).toBe("items.playgroundChat");
  });

  it("has no separate Agent entry (agent labelKey no longer present)", () => {
    const agentLabeled = playground?.items.filter(
      (item) => item.labelKey === "items.playgroundAgent",
    );
    expect(agentLabeled).toHaveLength(0);
  });

  it("has no separate /playground/chat entry (converged into the unified entry)", () => {
    const chatItems = playground?.items.filter((item) => item.to === "/playground/chat");
    expect(chatItems).toHaveLength(0);
  });

  it("keeps the other playground modalities untouched", () => {
    const targets = playground?.items.map((item) => item.to);
    expect(targets).toEqual([
      "/playground/agent",
      "/playground/image",
      "/playground/audio",
      "/playground/embeddings",
      "/playground/rerank",
    ]);
  });
});
