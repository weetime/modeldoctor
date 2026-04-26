import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom@24 does not implement Pointer Events or scrollIntoView.
// Radix UI primitives (Select, DropdownMenu, Dialog, Tabs) call these APIs,
// so we polyfill them globally once here rather than repeating the block in
// every test file that renders a Radix component.
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
});
