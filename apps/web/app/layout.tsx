import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { colors } from "@fin-creador/design-tokens";
import { Suspense } from "react";
import { NoticeToast } from "@/components/notice-toast";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime requests to Google).
// latin-ext covers the ₹ sign (U+20B9).
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Fin Creador", template: "%s · Fin Creador" },
  description: "Personal financial operating system",
};

export const viewport: Viewport = {
  themeColor: colors.canvas,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${manrope.variable} ${dmSans.variable}`}>
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
