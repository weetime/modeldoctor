import * as matchers from "@testing-library/jest-dom/matchers";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { type CSSProperties, createElement } from "react";
import { afterEach, expect, vi } from "vitest";

expect.extend(matchers);

// Global echarts mock — every test that renders a chart component previously
// repeated this same `vi.mock("echarts-for-react", ...)` block (14+ files,
// 3 minor variants of the same superset). Mocking globally here means:
//   - One canonical mock for the whole suite.
//   - JSDOM stays away from echarts' internals (which depend on Canvas APIs
//     JSDOM doesn't implement).
//   - New chart tests don't need to remember the mock incantation.
// The superset (option + style attributes) satisfies all prior variants —
// tests that only check `data-option` ignore `style` and vice versa.
vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option?: unknown; style?: CSSProperties }) =>
    createElement("div", {
      "data-testid": "echart",
      "data-option": option !== undefined ? JSON.stringify(option) : undefined,
      style,
    }),
}));

// jsdom@24 does not implement Pointer Events, scrollIntoView, or ResizeObserver.
// Radix UI primitives (Select, DropdownMenu, Dialog, Tabs, Slider) call these
// APIs, so we polyfill them globally once here rather than repeating the block
// in every test file that renders a Radix component.
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

// @radix-ui/react-slider uses ResizeObserver to track track/thumb dimensions.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
});
