import type { MetadataRoute } from "next";

import {
  NATIVE_APP_DESCRIPTION,
  NATIVE_APP_NAME,
  NATIVE_APP_START_URL,
} from "~/lib/pwa/native-app-metadata";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: NATIVE_APP_NAME,
    short_name: NATIVE_APP_NAME,
    description: NATIVE_APP_DESCRIPTION,
    start_url: NATIVE_APP_START_URL,
    scope: "/",
    display: "standalone",
    background_color: "#F2EDE6",
    theme_color: "#F2EDE6",
    orientation: "any",
    categories: ["business", "music", "productivity"],
    icons: [
      {
        src: "/icons/skitza-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/skitza-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/skitza-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/skitza-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
