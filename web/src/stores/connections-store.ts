import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Connection, ConnectionsExport } from "@/types/connection";

export type ConnectionInputForStore = Omit<
  Connection,
  "id" | "createdAt" | "updatedAt"
>;

export interface ConnectionsStore {
  connections: Connection[];
  list: () => Connection[];
  get: (id: string) => Connection | null;
  create: (input: ConnectionInputForStore) => Connection;
  update: (
    id: string,
    patch: Partial<Omit<Connection, "id" | "createdAt">>,
  ) => Connection;
  remove: (id: string) => void;
  exportAll: () => string;
  importAll: (
    json: string,
    mode: "merge" | "replace",
  ) => { added: number; skipped: number };
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `c_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function nameTaken(list: Connection[], name: string, exceptId?: string): boolean {
  return list.some((c) => c.name === name && c.id !== exceptId);
}

export const useConnectionsStore = create<ConnectionsStore>()(
  persist(
    (set, get) => ({
      connections: [],
      list: () =>
        [...get().connections].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
      get: (id) => get().connections.find((c) => c.id === id) ?? null,
      create: (input) => {
        const list = get().connections;
        if (nameTaken(list, input.name)) {
          throw new Error(`Connection name "${input.name}" already exists`);
        }
        const ts = nowIso();
        const c: Connection = {
          ...input,
          id: newId(),
          createdAt: ts,
          updatedAt: ts,
        };
        set({ connections: [...list, c] });
        return c;
      },
      update: (id, patch) => {
        const list = get().connections;
        const existing = list.find((c) => c.id === id);
        if (!existing) throw new Error(`Connection ${id} not found`);
        if (patch.name !== undefined && nameTaken(list, patch.name, id)) {
          throw new Error(`Connection name "${patch.name}" already exists`);
        }
        const updated: Connection = {
          ...existing,
          ...patch,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nowIso(),
        };
        set({
          connections: list.map((c) => (c.id === id ? updated : c)),
        });
        return updated;
      },
      remove: (id) => {
        set({ connections: get().connections.filter((c) => c.id !== id) });
      },
      exportAll: () => {
        const env: ConnectionsExport = {
          version: 1,
          connections: get().connections,
        };
        return JSON.stringify(env, null, 2);
      },
      importAll: (json, mode) => {
        const parsed = JSON.parse(json) as ConnectionsExport;
        if (parsed.version !== 1) {
          throw new Error(`Unsupported export version: ${parsed.version}`);
        }
        if (mode === "replace") {
          set({ connections: parsed.connections });
          return { added: parsed.connections.length, skipped: 0 };
        }
        const current = [...get().connections];
        let added = 0;
        let skipped = 0;
        for (const incoming of parsed.connections) {
          if (nameTaken(current, incoming.name)) {
            skipped += 1;
            continue;
          }
          current.push({ ...incoming, id: incoming.id || newId() });
          added += 1;
        }
        set({ connections: current });
        return { added, skipped };
      },
    }),
    {
      name: "md.connections.v1",
      partialize: (state) => ({ connections: state.connections }),
    },
  ),
);
