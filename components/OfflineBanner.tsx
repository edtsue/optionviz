"use client";
import { useOnline } from "@/lib/use-online";

// Sits at the top of every authenticated page (rendered from AppShell). The
// banner is hidden whenever navigator.onLine is true — the only signal we
// trust. Renders cached data behind it via the read-through cache in
// trades-client.ts; live data (spot polls, chat, calendar) errors silently.
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 border-b border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-center text-[11px] text-orange-300 backdrop-blur"
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-orange-400 align-middle" />
      Offline · showing the last-saved state. Spot, chat, and saves are paused
      until you reconnect.
    </div>
  );
}
