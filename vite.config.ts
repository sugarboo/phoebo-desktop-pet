import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  build: {
    // This single-entry local application has no dynamic chunks to preload.
    // Omitting Vite's compatibility polyfill removes idle DOM observers and fetch
    // plumbing that would never be exercised by the desktop pet.
    modulePreload: {
      polyfill: false,
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
