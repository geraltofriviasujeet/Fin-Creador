/**
 * Fired on window after a confirmed save (the success toasts, components/ui/toast.tsx), so the
 * offline snapshot is refreshed with the saved figures (components/pwa/snapshot-keeper.tsx).
 */
export const SAVED_EVENT = "fincreador:saved"

export function announceSaved() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVED_EVENT))
}
