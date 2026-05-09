import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Branded home-screen icon. iOS rejects SVG apple-touch-icons (the previous
// app/apple-icon.svg fell through to Safari's "first letter of title"
// fallback, showing a plain "O"), so this renders to a PNG via next/og.
//
// Design: dark slate background, lime accent wordmark "OV" (matches the
// trade-page accent #a3e635 + the in-app "Option<Viz>" brand). A subtle
// payoff-curve glyph anchors the bottom right so the icon reads as a
// finance/options tool rather than a generic "OV" badge.

export default function AppleIcon() {
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
          background:
            "radial-gradient(circle at 30% 20%, #1a2030 0%, #06080a 70%)",
          position: "relative",
        }}
      >
        {/* Wordmark — "O" in muted gray, "V" in lime, big and tight */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            fontWeight: 800,
            fontSize: 110,
            letterSpacing: -6,
            lineHeight: 1,
          }}
        >
          <span style={{ color: "#e6e8eb" }}>O</span>
          <span style={{ color: "#a3e635" }}>V</span>
        </div>

        {/* Payoff-curve glyph: a hockey-stick payoff crossing a strike line.
            Drawn with absolutely positioned spans because next/og's edge
            renderer doesn't run inline <svg> reliably for all sizes. */}
        <div
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 22,
            height: 24,
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* horizontal strike axis */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 12,
              height: 2,
              background: "rgba(230, 232, 235, 0.18)",
            }}
          />
          {/* loss segment (flat below axis) */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              width: 60,
              height: 3,
              background: "#ef4444",
              borderRadius: 2,
            }}
          />
          {/* profit segment (rising from strike) */}
          <div
            style={{
              position: "absolute",
              left: 60,
              top: 0,
              width: 70,
              height: 3,
              background: "#a3e635",
              borderRadius: 2,
              transform: "rotate(-22deg)",
              transformOrigin: "left center",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
