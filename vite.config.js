import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Copy runtime-referenced static assets (audio) that Vite can't trace from
// dynamic string paths into dist so deployed builds keep working.
function copyAudios() {
  return {
    name: "copy-audios",
    closeBundle() {
      const src = join("assets", "audios");
      const dest = join("dist", "assets", "audios");
      mkdirSync(dest, { recursive: true });
      for (const f of readdirSync(src)) {
        const s = join(src, f);
        if (statSync(s).isFile()) copyFileSync(s, join(dest, f));
      }
    },
  };
}

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
  plugins: [copyAudios()],
});
