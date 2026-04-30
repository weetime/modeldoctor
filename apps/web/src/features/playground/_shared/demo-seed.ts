/**
 * Per-feature "first-visit demo seed" flag, persisted in localStorage so
 * users see seeded inputs once. After the user has visited (and either
 * sent or cleared the demo), subsequent visits stay empty.
 *
 * Usage: call `consumeDemoSeed("embeddings")` from a useEffect on mount.
 * Returns true exactly once per browser per key; subsequent calls return
 * false. SSR-safe: returns false when window is unavailable.
 */
const PREFIX = "md-playground-demo-seeded-";

// Memoise per page-load so React Strict Mode (which double-invokes effects
// in dev) sees a stable answer across re-mounts. Without this, the first
// mount writes the localStorage flag, and the second mount sees the flag
// and refuses to seed — which throws away component-local state set by
// the first effect run.
const seedDecisionCache = new Map<string, boolean>();

export function consumeDemoSeed(key: string): boolean {
  if (typeof window === "undefined") return false;
  // Tests reset localStorage between cases; without this guard every test
  // would pick up the demo input on first render and break payload asserts.
  if (import.meta.env?.MODE === "test") return false;
  if (seedDecisionCache.has(key)) return seedDecisionCache.get(key) ?? false;
  let result = false;
  try {
    const k = PREFIX + key;
    if (window.localStorage.getItem(k) !== "1") {
      window.localStorage.setItem(k, "1");
      result = true;
    }
  } catch {
    /* noop */
  }
  seedDecisionCache.set(key, result);
  return result;
}
