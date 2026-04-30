import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#13171c",
        border: "#222831",
        accent: "#3b82f6",
        gain: "#22c55e",
        loss: "#ef4444",
      },
    },
  },
  plugins: [],
};
export default config;
