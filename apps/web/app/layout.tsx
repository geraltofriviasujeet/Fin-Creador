import type { Metadata, Viewport } from "next";
import { colors } from "@fin-creador/design-tokens";
import { Suspense } from "react";
import { NoticeToast } from "@/components/notice-toast";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { ToastProvider } from "@/components/ui/toast";
// Fonts are bundled from npm (Fontsource, SIL OFL 1.1): nothing is fetched from Google at dev,
// build or run time. Each subset loads only when the page uses it; latin-ext carries ₹ (U+20B9).
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FinCreador", template: "%s · FinCreador" },
  description: "Personal financial operating system",
  applicationName: "FinCreador",
  // The manifest (app/manifest.ts) is linked automatically. iPhone: installable from Safari's
  // Share menu, with its own icon (Sprint 12b).
  appleWebApp: { capable: true, title: "FinCreador", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: colors.canvas,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN">
      <body>
        <PwaProvider>
          <ToastProvider>
            {children}
            <Suspense fallback={null}>
              <NoticeToast />
            </Suspense>
          </ToastProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
