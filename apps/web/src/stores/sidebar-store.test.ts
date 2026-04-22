import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarStore } from "./sidebar-store";

const PERSIST_KEY = "md.sidebar-groups-collapsed.v1";

describe("useSidebarStore", () => {
	beforeEach(() => {
		localStorage.clear();
		useSidebarStore.getState().reset();
	});

	it("starts expanded with no groups collapsed", () => {
		const s = useSidebarStore.getState();
		expect(s.railCollapsed).toBe(false);
		expect(s.collapsedGroups).toEqual({});
	});

	it("toggleRail flips the rail flag", () => {
		useSidebarStore.getState().toggleRail();
		expect(useSidebarStore.getState().railCollapsed).toBe(true);
		useSidebarStore.getState().toggleRail();
		expect(useSidebarStore.getState().railCollapsed).toBe(false);
	});

	it("toggleGroup toggles a single group independently", () => {
		useSidebarStore.getState().toggleGroup("performance");
		expect(useSidebarStore.getState().collapsedGroups).toEqual({
			performance: true,
		});
		useSidebarStore.getState().toggleGroup("correctness");
		expect(useSidebarStore.getState().collapsedGroups).toEqual({
			performance: true,
			correctness: true,
		});
		useSidebarStore.getState().toggleGroup("performance");
		expect(useSidebarStore.getState().collapsedGroups).toEqual({
			performance: false,
			correctness: true,
		});
	});

	it("reset clears both group state and rail state", () => {
		useSidebarStore.getState().toggleRail();
		useSidebarStore.getState().toggleGroup("performance");
		useSidebarStore.getState().toggleGroup("debug");
		useSidebarStore.getState().reset();
		const s = useSidebarStore.getState();
		expect(s.railCollapsed).toBe(false);
		expect(s.collapsedGroups).toEqual({});
	});

	it("persists rail + groups to localStorage", () => {
		useSidebarStore.getState().toggleRail();
		useSidebarStore.getState().toggleGroup("correctness");
		const raw = localStorage.getItem(PERSIST_KEY);
		expect(raw).not.toBeNull();
		const persisted = (JSON.parse(raw as string) as { state: unknown })
			.state as { railCollapsed: boolean; collapsedGroups: object };
		expect(persisted.railCollapsed).toBe(true);
		expect(persisted.collapsedGroups).toEqual({ correctness: true });
	});
});
