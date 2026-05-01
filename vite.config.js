import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          markdown: ["react-markdown", "remark-gfm", "remark-math", "rehype-katex", "rehype-highlight"],
          katex: ["katex"],
        },
      },
    },
  },
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", "localhost", "127.0.0.1"],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
