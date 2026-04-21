import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarStore {
	collapsedGroups: Record<string, boolean>;
	toggleGroup: (id: string) => void;
}

export const useSidebarStore = create<SidebarStore>()(
	persist(
		(set) => ({
			collapsedGroups: {},
			toggleGroup: (id) =>
				set((s) => ({
					collapsedGroups: {
						...s.collapsedGroups,
						[id]: !s.collapsedGroups[id],
					},
				})),
		}),
		{ name: "md.sidebar-groups-collapsed.v1" },
	),
);
