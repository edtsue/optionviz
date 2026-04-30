import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#06080a",
        panel: "rgba(255,255,255,0.03)",
        border: "rgba(255,255,255,0.08)",
        borderHi: "rgba(255,255,255,0.16)",
        accent: "#a3e635",
        accentDim: "#65a30d",
        gain: "#10b981",
        loss: "#f43f5e",
        warn: "#f59e0b",
        muted: "#64748b",
        text: "#e5e7eb",
        textDim: "#94a3b8",
      },
      fontFamily: {
        mono: [
          "SF Mono",
          "JetBrains Mono",
          "Menlo",
          "Monaco",
          "ui-monospace",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
