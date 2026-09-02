import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Sudoku Vision Solver",
  description:
    "Point your camera at a Sudoku puzzle and get it solved instantly. Computer vision, OCR, and an exact-cover solver all run in your browser — no server, no upload, works offline.",
  keywords: ["Sudoku", "solver", "OCR", "computer vision", "PWA", "offline", "puzzle"],
  applicationName: "Sudoku Vision Solver",
  manifest: `${basePath}/manifest.json`,
  icons: {
    icon: [
      { url: `${basePath}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${basePath}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `${basePath}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sudoku Solver",
  },
  openGraph: {
    title: "Sudoku Vision Solver",
    description: "Camera-to-solution Sudoku solver. 100% client-side, works offline.",
    type: "website",
  },
  other: {
    // Next 16's `appleWebApp.capable` only emits the modern unprefixed
    // "mobile-web-app-capable" tag. Older/some current iOS Safari versions
    // still key standalone (full-screen, no browser chrome) launch off the
    // Apple-prefixed tag specifically — without it, "Add to Home Screen"
    // opens inside Safari instead of as an installed app.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
