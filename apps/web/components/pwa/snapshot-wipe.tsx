"use client"

import { useEffect } from "react"
import { getPublicEnv } from "@/lib/env"
import { finishPendingSignOut } from "@/lib/pwa/offline-sign-out"
import { SNAPSHOT_IDB } from "@/lib/pwa/snapshot"
import { idbClear } from "@/lib/pwa/snapshot-idb"

/**
 * On the sign-in and sign-up pages (app/(auth)/layout.tsx): deletes any offline snapshot left
 * on this device (Sprint 12b). Every sign-out lands here, so a snapshot never outlives the
 * session it came from, even if the sign-out form couldn't delete it first. Also finishes an
 * offline sign-out on the server once the device is online (lib/pwa/offline-sign-out.ts).
 */
export function SnapshotWipe() {
  useEffect(() => {
    void idbClear(SNAPSHOT_IDB)
    const env = getPublicEnv()
    const finish = () => void finishPendingSignOut(env)
    finish()
    window.addEventListener("online", finish)
    return () => window.removeEventListener("online", finish)
  }, [])
  return null
}
