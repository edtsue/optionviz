import type { MetadataRoute } from "next";

// Web app manifest — Chrome (Android, desktop, and iOS via share sheet) reads
// this to pick the home-screen icon. Without it, Chrome auto-generates an
// icon from the favicon, which collapses to a flat "O" for OptionViz.
//
// Safari/iOS continues to use app/apple-icon.tsx — both stay in sync because
// they reference the same /apple-icon route plus a 512px variant for the
// splash screen.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OptionViz",
    short_name: "OptionViz",
    description: "Visualize option trades, payoffs, Greeks, and ideas",
    start_url: "/",
    display: "standalone",
    background_color: "#06080a",
    theme_color: "#06080a",
    icons: [
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
