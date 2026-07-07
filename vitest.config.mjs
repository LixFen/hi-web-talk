import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/__tests__/**/*.test.js"],
    exclude: ["node_modules", "dist", ".kilo"],
    // better-sqlite3 是原生模块，在纯单元测试中不加载它
    server: {
      deps: {
        inline: [/better-sqlite3/, /sql\.js/],
      },
    },
  },
});
