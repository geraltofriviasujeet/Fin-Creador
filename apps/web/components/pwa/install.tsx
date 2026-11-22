"use client"

import { useEffect, useState } from "react"
import { Download, Share, SquarePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogClose, SHEET_ACTIONS } from "@/components/ui/dialog"
import { countVisit, dismissInstall, installDismissed, showInstallCard } from "@/lib/pwa/install"
import { useInstall } from "./pwa-provider"

// Installing FinCreador (Sprint 12b): the Settings entry and the phone card. Chrome and
// Android get the browser's own install dialog; iPhone Safari gets the Share → Add to Home
// Screen steps. Nothing shows once installed.

/** The iPhone steps, as a sheet. */
function IosSteps({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent eyebrow="Install" title="Add FinCreador to your Home Screen">
        <ol className="grid gap-3 text-sm text-ink">
          <li className="flex items-start gap-3">
            <Share aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <span>
              Tap <strong>Share</strong> in Safari’s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <SquarePlus aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <span>
              Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </span>
          </li>
        </ol>
        <div className={`mt-5 flex justify-end ${SHEET_ACTIONS}`}>
          <DialogClose render={<Button type="button" variant="secondary" />}>Done</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Install action for Settings: a button, or how to do it by hand; once installed, just says so. */
export function InstallSetting() {
  const install = useInstall()
  const [steps, setSteps] = useState(false)
  if (install.installed) return <p className="mt-4 text-sm text-ink">FinCreador is installed on this device.</p>
  return (
    <div className="mt-4 grid gap-3">
      {install.canPrompt ? (
        <div>
          <Button type="button" onClick={() => void install.prompt()}>
            <Download aria-hidden="true" />
            Install FinCreador
          </Button>
        </div>
      ) : install.iosSafari ? (
        <div>
          <Button type="button" onClick={() => setSteps(true)}>
            <Download aria-hidden="true" />
            Install FinCreador
          </Button>
          <IosSteps open={steps} onOpenChange={setSteps} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          To install, open your browser’s menu and choose <strong className="text-ink">Install app</strong> or{" "}
          <strong className="text-ink">Add to Home Screen</strong>. Some browsers don’t offer it.
        </p>
      )}
    </div>
  )
}

const PHONE_QUERY = "(max-width: 760px)"

/**
 * The phone card (below md): from the second visit after sign-in, until dismissed once.
 * In the app layout, above the page.
 */
export function InstallCard() {
  const install = useInstall()
  const [eligible, setEligible] = useState<{ visits: number; dismissed: boolean; phone: boolean } | null>(null)
  const [steps, setSteps] = useState(false)

  useEffect(() => {
    const visits = countVisit(window.localStorage, window.sessionStorage)
    const read = () => setEligible({ visits, dismissed: installDismissed(window.localStorage), phone: window.matchMedia(PHONE_QUERY).matches })
    read()
    const query = window.matchMedia(PHONE_QUERY)
    query.addEventListener("change", read)
    return () => query.removeEventListener("change", read)
  }, [])

  if (!eligible || !showInstallCard({ ...eligible, installed: install.installed, canPrompt: install.canPrompt, iosSafari: install.iosSafari })) return null

  const dismiss = () => {
    dismissInstall(window.localStorage)
    setEligible({ ...eligible, dismissed: true })
  }

  return (
    <section aria-label="Install FinCreador" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-sm md:hidden">
      <Download aria-hidden="true" className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-ink">Install FinCreador on your Home Screen for quicker entry.</p>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          if (install.canPrompt) void install.prompt()
          else setSteps(true)
        }}
      >
        Install
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss install suggestion" onClick={dismiss}>
        <X aria-hidden="true" />
      </Button>
      {install.iosSafari && <IosSteps open={steps} onOpenChange={setSteps} />}
    </section>
  )
}
