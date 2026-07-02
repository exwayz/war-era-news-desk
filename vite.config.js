import { defineConfig } from "vite";

export default defineConfig({
  base: "/war-era-news-desk/",
  server: {
    port: 8023,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
