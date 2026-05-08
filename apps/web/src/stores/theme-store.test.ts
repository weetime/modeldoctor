import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "./theme-store";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    useThemeStore.setState({ mode: "system" });
  });

  it("defaults to system mode", () => {
    expect(useThemeStore.getState().mode).toBe("system");
  });

  it("setMode('dark') adds the .dark class to <html>", () => {
    useThemeStore.getState().setMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setMode('light') removes the .dark class", () => {
    document.documentElement.classList.add("dark");
    useThemeStore.getState().setMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setMode('system') follows prefers-color-scheme", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("dark"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    useThemeStore.getState().setMode("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reset() restores mode=system", () => {
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().reset();
    expect(useThemeStore.getState().mode).toBe("system");
  });

  it("rehydrates legacy {mode, palette} payload by ignoring palette", async () => {
    localStorage.setItem(
      "md.theme.v1",
      JSON.stringify({ state: { mode: "dark", palette: "plum" }, version: 0 }),
    );
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
