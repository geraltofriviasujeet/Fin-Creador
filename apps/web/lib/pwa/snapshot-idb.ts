import type { SnapshotIdb } from "./snapshot"

// IndexedDB access for the offline snapshot. Each function is self-contained (it uses only its
// parameters and browser globals, no imports or module scope): the offline page inlines
// idbRead and idbClear as they are, so the app and that page read the store the same way.
// Every call fails soft: a private window or blocked storage reads as "nothing saved".

export function idbRead(idb: SnapshotIdb): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(idb.db, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(idb.store)
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const db = open.result
        try {
          const get = db.transaction(idb.store, "readonly").objectStore(idb.store).get(idb.key)
          get.onsuccess = () => {
            db.close()
            resolve(get.result ?? null)
          }
          get.onerror = () => {
            db.close()
            resolve(null)
          }
        } catch {
          db.close()
          resolve(null)
        }
      }
    } catch {
      resolve(null)
    }
  })
}

export function idbWrite(idb: SnapshotIdb, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(idb.db, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(idb.store)
      open.onerror = () => resolve(false)
      open.onsuccess = () => {
        const db = open.result
        try {
          const tx = db.transaction(idb.store, "readwrite")
          tx.objectStore(idb.store).put(value, idb.key)
          tx.oncomplete = () => {
            db.close()
            resolve(true)
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            resolve(false)
          }
        } catch {
          db.close()
          resolve(false)
        }
      }
    } catch {
      resolve(false)
    }
  })
}

export function idbClear(idb: SnapshotIdb): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(idb.db, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(idb.store)
      open.onerror = () => resolve(false)
      open.onsuccess = () => {
        const db = open.result
        try {
          const tx = db.transaction(idb.store, "readwrite")
          tx.objectStore(idb.store).clear()
          tx.oncomplete = () => {
            db.close()
            resolve(true)
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            resolve(false)
          }
        } catch {
          db.close()
          resolve(false)
        }
      }
    } catch {
      resolve(false)
    }
  })
}
