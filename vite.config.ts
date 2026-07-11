import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");

          if (normalized.includes("vite/preload-helper")) {
            return "vendor-vite-runtime";
          }

          if (!normalized.includes("/node_modules/")) return undefined;

          if (
            normalized.includes("/node_modules/.pnpm/posthog-js@") ||
            normalized.includes("/node_modules/posthog-js/")
          ) {
            return "vendor-posthog";
          }

          if (
            normalized.includes("/node_modules/.pnpm/react@") ||
            normalized.includes("/node_modules/.pnpm/react-dom@") ||
            normalized.includes("/node_modules/.pnpm/scheduler@") ||
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }

          if (
            normalized.includes("react-markdown") ||
            normalized.includes("remark-gfm")
          ) {
            return "vendor-markdown";
          }

          if (
            normalized.includes("react-syntax-highlighter") ||
            normalized.includes("/refractor/")
          ) {
            return "vendor-syntax";
          }

          if (
            normalized.includes("@xterm/xterm") ||
            normalized.includes("@xterm/addon-fit")
          ) {
            return "vendor-xterm";
          }

          if (
            normalized.includes("/konva/") ||
            normalized.includes("react-konva")
          ) {
            return "vendor-konva";
          }

          if (normalized.includes("/diff/")) {
            return "vendor-diff";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
