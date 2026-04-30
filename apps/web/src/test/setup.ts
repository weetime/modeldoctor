import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
