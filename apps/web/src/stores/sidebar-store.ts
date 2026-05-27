import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarStore {
  /** Per-group "collapse this section's items" flags. */
  collapsedGroups: Record<string, boolean>;
  /** Whole-sidebar rail mode: show icon-only column instead of full sidebar. */
  railCollapsed: boolean;
  /** Transient override — detail pages set this so the parent list item stays
   *  highlighted while viewing a record whose URL (/benchmarks/:id) doesn't
   *  match the list URL (/benchmarks/gateway etc.). Not persisted. */
  activePath: string | null;
  toggleGroup: (id: string) => void;
  toggleRail: () => void;
  setActivePath: (path: string | null) => void;
  /** Forget group-collapse state and expand the rail. */
  reset: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsedGroups: {},
      railCollapsed: false,
      activePath: null,
      toggleGroup: (id) =>
        set((s) => ({
          collapsedGroups: {
            ...s.collapsedGroups,
            [id]: !s.collapsedGroups[id],
          },
        })),
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      setActivePath: (path) => set({ activePath: path }),
      reset: () => set({ collapsedGroups: {}, railCollapsed: false }),
    }),
    {
      name: "md.sidebar-groups-collapsed.v1",
      partialize: (s) => ({ collapsedGroups: s.collapsedGroups, railCollapsed: s.railCollapsed }),
    },
  ),
);
