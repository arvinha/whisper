import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Whisper – AI-assistent för dina samtal",
    short_name: "Whisper",
    description: "Aivia följer samtalet, antecknar live och ger dig en kort ledtråd när du trycker.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07070a",
    theme_color: "#07070a",
    lang: "sv",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
