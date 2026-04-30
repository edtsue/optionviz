import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OptionViz",
  description: "Visualize option trades, payoffs, Greeks, and ideas",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              OptionViz
            </Link>
            <nav className="flex gap-2 text-sm">
              <Link href="/" className="text-gray-400 hover:text-white">
                Trades
              </Link>
              <Link href="/trade/new" className="btn-primary inline-flex items-center rounded-lg px-3 py-1.5">
                + New
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
