"use client"

import { Tooltip } from "@base-ui/react/tooltip"
import { Globe } from "lucide-react"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button-variants"
import { FINCREADOR_WEBSITE_LABEL, FINCREADOR_WEBSITE_URL } from "@/lib/site"

/**
 * Topbar link to the FinCreador website, next to the bell. Same tab, like any link. Phones
 * (≤ 640px) get it in the tab bar's "More" menu instead (tab-bar.tsx), so it is hidden here.
 * A plain <a>: it leaves the app, so there is nothing for the Next router to prefetch.
 */
export function WebsiteLink() {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <a
              href={FINCREADOR_WEBSITE_URL}
              aria-label={FINCREADOR_WEBSITE_LABEL}
              data-testid="website-link"
              className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "max-[640px]:hidden")}
            />
          }
        >
          <Globe aria-hidden="true" className="size-5" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8} className="z-40">
            <Tooltip.Popup className="rounded-md bg-ink px-2 py-1 text-xs text-surface shadow-(--shadow-raised)">
              {FINCREADOR_WEBSITE_LABEL}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
