"use client"

import { useEffect } from "react"
import { SNAPSHOT_IDB } from "@/lib/pwa/snapshot"
import { idbClear } from "@/lib/pwa/snapshot-idb"

/**
 * On the sign-in and sign-up pages (app/(auth)/layout.tsx): deletes any offline snapshot left
 * on this device (Sprint 12b). Every sign-out lands here, so a snapshot never outlives the
 * session it came from, even if the sign-out form couldn't delete it first.
 */
export function SnapshotWipe() {
  useEffect(() => {
    void idbClear(SNAPSHOT_IDB)
  }, [])
  return null
}
