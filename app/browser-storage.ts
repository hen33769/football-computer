export type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Safari can expose Web Storage while rejecting writes (for example when the
 * origin quota is unavailable). Keep the app usable by falling back to memory;
 * D1 remains the source of truth for cloud data.
 */
export function createResilientStorage(
  resolveStorage: () => BrowserStorage | null,
  canUseMemory: () => boolean = () => true,
): BrowserStorage {
  const memory = new Map<string, string>();
  const pendingOverrides = new Set<string>();

  const resolvedStorage = () => {
    try {
      return resolveStorage();
    } catch {
      return null;
    }
  };

  return {
    getItem(key) {
      if (!canUseMemory()) return null;
      if (pendingOverrides.has(key)) return memory.get(key) ?? null;
      try {
        const value = resolvedStorage()?.getItem(key) ?? null;
        if (value !== null) memory.set(key, value);
        return value ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      if (!canUseMemory()) return;
      memory.set(key, value);
      try {
        const storage = resolvedStorage();
        if (!storage) {
          pendingOverrides.add(key);
          return;
        }
        storage.setItem(key, value);
        pendingOverrides.delete(key);
      } catch {
        pendingOverrides.add(key);
      }
    },
    removeItem(key) {
      if (!canUseMemory()) return;
      memory.delete(key);
      try {
        const storage = resolvedStorage();
        if (!storage) {
          pendingOverrides.add(key);
          return;
        }
        storage.removeItem(key);
        pendingOverrides.delete(key);
      } catch {
        pendingOverrides.add(key);
      }
    },
  };
}

const isBrowser = () => typeof window !== "undefined";

export const localCache = createResilientStorage(
  () => isBrowser() ? window.localStorage : null,
  isBrowser,
);

export const sessionCache = createResilientStorage(
  () => isBrowser() ? window.sessionStorage : null,
  isBrowser,
);
