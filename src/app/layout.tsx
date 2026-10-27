import type { Metadata, Viewport } from "next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Whisper – AI-assistent för dina samtal",
  description:
    "Aivia följer samtalet, antecknar live och ger dig en kort ledtråd ur ditt eget underlag när du trycker. För möten, redovisningar och plugg. Testa gratis i 2 dagar.",
  applicationName: "Whisper",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Whisper",
    locale: "sv_SE",
    title: "Whisper – AI-assistent för dina samtal",
    description: "Din AI-assistent i varje samtal. Testa gratis i 2 dagar.",
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: {
    capable: true,
    title: "Whisper",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07070a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sv" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
