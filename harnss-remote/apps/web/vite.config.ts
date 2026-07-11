import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
