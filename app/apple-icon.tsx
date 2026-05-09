import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Branded home-screen icon, kept rigid so next/og's edge renderer can't trip
// on it. Every element is display:flex (next/og requires it on any node with
// children) and there are no gradients, no radial backgrounds, no SVG — all
// of which have inconsistent satori/next-og support across runtimes.

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
          background: "#06080a",
        }}
      >
        {/* Big "OV" wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            fontWeight: 800,
            fontSize: 110,
            letterSpacing: -6,
            lineHeight: 1,
            color: "#e6e8eb",
          }}
        >
          <span style={{ color: "#e6e8eb" }}>O</span>
          <span style={{ color: "#a3e635" }}>V</span>
        </div>

        {/* Hockey-stick payoff: red flat loss, lime rising profit. The strike
            line is a thin gray bar. All elements are absolutely positioned
            within a flex container so next/og handles them predictably. */}
        <div
          style={{
            display: "flex",
            position: "relative",
            marginTop: 14,
            width: 132,
            height: 24,
          }}
        >
          {/* strike axis */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 0,
              top: 12,
              width: 132,
              height: 2,
              background: "rgba(230,232,235,0.18)",
            }}
          />
          {/* loss segment */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 0,
              top: 13,
              width: 56,
              height: 3,
              background: "#ef4444",
              borderRadius: 2,
            }}
          />
          {/* profit segment */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 56,
              top: 0,
              width: 76,
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
