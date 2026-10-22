import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Squared Away Performance Horses",
    short_name: "Squared Away",
    description: "Your horses, training updates, and barn office in one place.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f6f4ee",
    theme_color: "#30291f",
    lang: "en-US",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
