import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", "localhost", "127.0.0.1"],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
