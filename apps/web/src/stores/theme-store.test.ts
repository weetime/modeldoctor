import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "./theme-store";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.palette = "";
    useThemeStore.setState({ mode: "system", palette: "slate" });
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

  it("defaults to slate palette", () => {
    expect(useThemeStore.getState().palette).toBe("slate");
  });

  it("setPalette('aurora') writes data-palette='aurora' on <html>", () => {
    useThemeStore.getState().setPalette("aurora");
    expect(document.documentElement.dataset.palette).toBe("aurora");
    expect(useThemeStore.getState().palette).toBe("aurora");
  });

  it("setPalette is independent of mode", () => {
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().setPalette("plum");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.palette).toBe("plum");
  });

  it("reset() restores mode=system AND palette=slate", () => {
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().setPalette("clay");
    useThemeStore.getState().reset();
    expect(useThemeStore.getState().mode).toBe("system");
    expect(useThemeStore.getState().palette).toBe("slate");
    expect(document.documentElement.dataset.palette).toBe("slate");
  });

  it("rehydrates legacy {mode} payload with default palette=slate", async () => {
    localStorage.setItem(
      "md.theme.v1",
      JSON.stringify({ state: { mode: "dark" }, version: 0 }),
    );
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().palette).toBe("slate");
    expect(document.documentElement.dataset.palette).toBe("slate");
  });
});
