import type { Metadata, Viewport } from "next";
import { colors } from "@fin-creador/design-tokens";
import { Suspense } from "react";
import { NoticeToast } from "@/components/notice-toast";
import { ToastProvider } from "@/components/ui/toast";
// Fonts are bundled from npm (Fontsource, SIL OFL 1.1): nothing is fetched from Google at dev,
// build or run time. Each subset loads only when the page uses it; latin-ext carries ₹ (U+20B9).
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FinCreador", template: "%s · FinCreador" },
  description: "Personal financial operating system",
};

export const viewport: Viewport = {
  themeColor: colors.canvas,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN">
      <body>
        <ToastProvider>
          {children}
          <Suspense fallback={null}>
            <NoticeToast />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
