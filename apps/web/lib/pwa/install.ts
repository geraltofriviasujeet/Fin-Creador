// When the phone install card shows (Sprint 12b): never on the first visit after sign-in, from
// the second visit (a new browser session) on, until it is dismissed once (remembered on this
// device), and never once installed or where installing isn't possible.

export const INSTALL_VISITS_KEY = "fincreador-app-visits"
export const INSTALL_DISMISSED_KEY = "fincreador-install-dismissed"
/** sessionStorage: this browser session was already counted. */
export const INSTALL_SESSION_KEY = "fincreador-visit-counted"

type Store = Pick<Storage, "getItem" | "setItem">

/** Counts this browser session as one visit (once per session) and returns the visit count. */
export function countVisit(local: Store, session: Store): number {
  try {
    const visits = Number(local.getItem(INSTALL_VISITS_KEY)) || 0
    if (session.getItem(INSTALL_SESSION_KEY)) return visits
    session.setItem(INSTALL_SESSION_KEY, "1")
    local.setItem(INSTALL_VISITS_KEY, String(visits + 1))
    return visits + 1
  } catch {
    return 0 // storage blocked: treat as a first visit (no card)
  }
}

export function installDismissed(local: Store): boolean {
  try {
    return local.getItem(INSTALL_DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

export function dismissInstall(local: Store) {
  try {
    local.setItem(INSTALL_DISMISSED_KEY, "1")
  } catch {
    // Blocked storage: hidden for this page only.
  }
}

export function showInstallCard(s: { visits: number; dismissed: boolean; phone: boolean; installed: boolean; canPrompt: boolean; iosSafari: boolean }): boolean {
  return s.visits >= 2 && !s.dismissed && s.phone && !s.installed && (s.canPrompt || s.iosSafari)
}

/** iPhone or iPad Safari (not Chrome, Firefox or Edge on iOS, which can't add to the home screen the same way). */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)
}
