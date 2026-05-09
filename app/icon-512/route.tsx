import { ImageResponse } from "next/og";

export const runtime = "edge";

// 512×512 PNG variant referenced by app/manifest.ts. Chrome's "Install app"
// flow prefers a 512px icon and uses it for the splash screen on Android.
// Same design as apple-icon.tsx (OV wordmark + hockey-stick payoff curve),
// just scaled up — kept rigid (every node display:flex, no gradients) so
// next/og's edge renderer won't choke.

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#06080a",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            fontWeight: 800,
            fontSize: 312,
            letterSpacing: -16,
            lineHeight: 1,
          }}
        >
          <span style={{ color: "#e6e8eb" }}>O</span>
          <span style={{ color: "#a3e635" }}>V</span>
        </div>
        <div
          style={{
            display: "flex",
            position: "relative",
            marginTop: 40,
            width: 376,
            height: 68,
          }}
        >
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 0,
              top: 34,
              width: 376,
              height: 6,
              background: "rgba(230,232,235,0.18)",
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 0,
              top: 36,
              width: 160,
              height: 8,
              background: "#ef4444",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 160,
              top: 0,
              width: 216,
              height: 8,
              background: "#a3e635",
              borderRadius: 4,
              transform: "rotate(-22deg)",
              transformOrigin: "left center",
            }}
          />
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
