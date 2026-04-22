import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "./tailwind.config";
import type { Plugin } from "vite";

/** Strip emoji from third-party library strings (e.g. React Router default error boundary). */
function stripThirdPartyEmoji(): Plugin {
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
  return {
    name: "strip-third-party-emoji",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") {
          chunk.code = chunk.code.replace(emojiRe, "");
        }
      }
    },
  };
}

// Ports are overridable so multiple git worktrees can run `pnpm dev`
// concurrently without colliding. Set VITE_PORT / API_PORT in the shell
// (or a .env file; Vite loads .env automatically for `vite dev`).
const VITE_PORT = Number(process.env.VITE_PORT) || 5173;
const API_PORT = Number(process.env.API_PORT) || 3001;

export default defineConfig({
  root: path.resolve(__dirname),
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
  plugins: [react(), stripThirdPartyEmoji()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
