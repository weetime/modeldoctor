import { isValidElement } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AgentPage } from "@/features/playground/agent/AgentPage";
import { ChatComparePage } from "@/features/playground/chat-compare/ChatComparePage";
import { routes } from "./index";

function findByPath(items: RouteObject[], path: string): RouteObject | undefined {
  for (const item of items) {
    if (item.path === path) return item;
    if (item.children) {
      const found = findByPath(item.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function navigateTarget(route: RouteObject | undefined): string | undefined {
  const el = route?.element;
  if (!isValidElement(el) || el.type !== Navigate) return undefined;
  return (el.props as { to?: string }).to;
}

describe("playground route convergence", () => {
  it("redirects the bare /playground index to the unified /playground/agent page", () => {
    const route = findByPath(routes, "playground");
    expect(navigateTarget(route)).toBe("/playground/agent");
  });

  it("redirects /playground/chat to the unified /playground/agent page", () => {
    const route = findByPath(routes, "playground/chat");
    expect(navigateTarget(route)).toBe("/playground/agent");
  });

  it("serves the unified AgentPage at /playground/agent", () => {
    const route = findByPath(routes, "playground/agent");
    expect(isValidElement(route?.element) && route?.element.type).toBe(AgentPage);
  });

  it("leaves /playground/chat/compare untouched (ChatComparePage, out of scope)", () => {
    const route = findByPath(routes, "playground/chat/compare");
    expect(isValidElement(route?.element) && route?.element.type).toBe(ChatComparePage);
  });

  it("leaves the other playground modalities untouched", () => {
    for (const path of [
      "playground/image",
      "playground/audio",
      "playground/embeddings",
      "playground/rerank",
    ]) {
      expect(findByPath(routes, path)).toBeDefined();
    }
  });
});
