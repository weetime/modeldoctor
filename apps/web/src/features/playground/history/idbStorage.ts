import { type IDBPDatabase, openDB } from "idb";

export const DB_NAME = "modeldoctor-playground";
// Bump DB_VERSION only alongside a new upgrade(db) migration step — IDB will reject the open otherwise.
const DB_VERSION = 1;
const STATE_STORE = "state"; // zustand JSON state
const BLOB_STORE = "blobs"; // binary attachments

interface BlobRow {
  entryId: string;
  key: string;
  blob: Blob;
}

function openPlaygroundDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE);
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        const s = db.createObjectStore(BLOB_STORE, {
          keyPath: ["entryId", "key"],
        });
        s.createIndex("byEntry", "entryId");
      }
    },
  });
}

export interface IdbStorage {
  // Zustand persist storage interface (string-based)
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  // Phase 4 additions:
  putBlob(entryId: string, key: string, blob: Blob): Promise<void>;
  getBlob(entryId: string, key: string): Promise<Blob | null>;
  deleteEntryBlobs(entryId: string): Promise<void>;
}

/**
 * Create an IDB-backed storage instance.
 *
 * @param dbName - database name (default: "modeldoctor-playground").
 *   Pass a unique name per test to get isolation without cross-test teardown.
 */
export function createIdbStorage(dbName = DB_NAME): IdbStorage {
  let dbPromise: Promise<IDBPDatabase> | null = null;

  function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      dbPromise = openPlaygroundDb(dbName);
    }
    return dbPromise;
  }

  return {
    async getItem(key) {
      const db = await getDb();
      const v = await db.get(STATE_STORE, key);
      return typeof v === "string" ? v : null;
    },
    async setItem(key, value) {
      const db = await getDb();
      await db.put(STATE_STORE, value, key);
    },
    async removeItem(key) {
      const db = await getDb();
      await db.delete(STATE_STORE, key);
    },
    async putBlob(entryId, key, blob) {
      const db = await getDb();
      const row: BlobRow = { entryId, key, blob };
      await db.put(BLOB_STORE, row);
    },
    async getBlob(entryId, key) {
      const db = await getDb();
      const row = (await db.get(BLOB_STORE, [entryId, key])) as BlobRow | undefined;
      return row?.blob ?? null;
    },
    async deleteEntryBlobs(entryId) {
      const db = await getDb();
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const idx = tx.store.index("byEntry");
      let cursor = await idx.openCursor(IDBKeyRange.only(entryId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}

/**
 * Shared singleton used by createHistoryStore (module-level to survive HMR).
 * Production code uses this; tests create fresh instances via createIdbStorage(uniqueName).
 */
export const idb: IdbStorage = createIdbStorage();
