import type { Metadata, Viewport } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-nd-playfair",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-nd-dm-sans",
});

export const metadata: Metadata = {
  title: { default: "Ndiho Space — Confidential online therapy", template: "%s · Ndiho Space" },
  description:
    "Ndiho Space connects you with verified therapists over secure video — confidentially, conveniently and compassionately. Available across Rwanda and Africa.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#244267",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable}`}>
      <body className="flex min-h-screen flex-col bg-nd-background font-nd-sans text-nd-on-background antialiased">
        {children}
      </body>
    </html>
  );
}
