import assert from "node:assert/strict";
import test from "node:test";
import { createResilientStorage, type BrowserStorage } from "../app/browser-storage";

const createMemoryStorage = (): BrowserStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

test("uses persistent browser storage when it is available", () => {
  const persistent = createMemoryStorage();
  const storage = createResilientStorage(() => persistent);

  storage.setItem("account", "smgr");
  assert.equal(storage.getItem("account"), "smgr");
  storage.removeItem("account");
  assert.equal(storage.getItem("account"), null);
});

test("falls back to memory when Safari rejects storage writes", () => {
  const quotaStorage: BrowserStorage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
    removeItem: () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
  };
  const storage = createResilientStorage(() => quotaStorage);

  assert.doesNotThrow(() => storage.setItem("matches", "[1,2,3]"));
  assert.equal(storage.getItem("matches"), "[1,2,3]");
  assert.doesNotThrow(() => storage.removeItem("matches"));
  assert.equal(storage.getItem("matches"), null);
});

test("falls back to memory when access to browser storage is denied", () => {
  const storage = createResilientStorage(() => {
    throw new DOMException("Access denied", "SecurityError");
  });

  storage.setItem("orders", "[]");
  assert.equal(storage.getItem("orders"), "[]");
});
