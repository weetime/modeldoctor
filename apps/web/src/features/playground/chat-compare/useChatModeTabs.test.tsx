import "@/lib/i18n";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useChatModeTabs } from "./useChatModeTabs";

function wrapperFor(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe("useChatModeTabs", () => {
  it("returns active='single' on /playground/chat", () => {
    const { result } = renderHook(() => useChatModeTabs(), {
      wrapper: wrapperFor("/playground/chat"),
    });
    expect(result.current.active).toBe("single");
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0].key).toBe("single");
    expect(result.current.tabs[1].key).toBe("compare");
  });

  it("returns active='compare' on /playground/chat/compare", () => {
    const { result } = renderHook(() => useChatModeTabs(), {
      wrapper: wrapperFor("/playground/chat/compare"),
    });
    expect(result.current.active).toBe("compare");
  });

  it("falls back to active='single' for unrelated paths", () => {
    const { result } = renderHook(() => useChatModeTabs(), {
      wrapper: wrapperFor("/some/other/path"),
    });
    expect(result.current.active).toBe("single");
  });
});
