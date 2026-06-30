process.env.IS_ANDROID = "1";
process.env.NODE_ENV = "production";

import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

// Load bridge → sends "ready" to Capacitor plugin (engine is alive)
require("bridge");

// Polyfill global fetch for nodejs-mobile (may not have native fetch)
if (typeof globalThis.fetch === "undefined") {
  const { default: fetch, Headers, Request, Response } = await import("node-fetch");
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Use a writable data directory inside the nodejs project
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HI_WEB_TALK_DATA_DIR ||= path.join(__dirname, "data");
process.env.JWT_SECRET ||= "hi-web-talk-android-secret-please-change";

await fs.mkdir(process.env.HI_WEB_TALK_DATA_DIR, { recursive: true });

// Import server module (routes, middleware, ensureDataLayout)
const { startServer } = await import("./server/index.js");

// Start listening (server is already set up, just needs to bind the port)
const port = Number(process.env.OPENAI_PORT || 8787);
await startServer(port);
