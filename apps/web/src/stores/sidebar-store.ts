import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarStore {
  /** Per-group "collapse this section's items" flags. */
  collapsedGroups: Record<string, boolean>;
  /** Whole-sidebar rail mode: show icon-only column instead of full sidebar. */
  railCollapsed: boolean;
  toggleGroup: (id: string) => void;
  toggleRail: () => void;
  /** Forget group-collapse state and expand the rail. */
  reset: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsedGroups: {},
      railCollapsed: false,
      toggleGroup: (id) =>
        set((s) => ({
          collapsedGroups: {
            ...s.collapsedGroups,
            [id]: !s.collapsedGroups[id],
          },
        })),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      reset: () => set({ collapsedGroups: {}, railCollapsed: false }),
    }),
    { name: "md.sidebar-groups-collapsed.v1" },
  ),
);
