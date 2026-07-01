process.env.IS_ANDROID = "1";
process.env.NODE_ENV = "production";

import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

// Polyfill File global — undici v7 (used by cheerio) requires it;
// nodejs-mobile's Node 18.20.4 doesn't provide File out of the box.
if (typeof globalThis.File === "undefined") {
  globalThis.File = class File extends Blob {
    constructor(bits, name, options = {}) {
      super(bits, options);
      this.name = name;
      this.lastModified = options.lastModified ?? Date.now();
    }
  };
}

// Load bridge → sends "ready" to Capacitor plugin (engine is alive)
require("bridge");

// Note: node-fetch v3 brings undici which crashes nodejs-mobile (SIGSEGV).
// We rely on Node.js 18's experimental native fetch if available.
// Web search / scraping features requiring fetch will be unavailable if native fetch is absent.

// Use a writable data directory inside the nodejs project
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HI_WEB_TALK_DATA_DIR ||= path.join(__dirname, "data");
process.env.JWT_SECRET ||= "hi-web-talk-android-secret-please-change";

await fs.mkdir(process.env.HI_WEB_TALK_DATA_DIR, { recursive: true });

// Import server module (routes, middleware, ensureDataLayout)
async function start() {
  try {
    const { startServer } = await import("./server/index.js");
    const port = Number(process.env.OPENAI_PORT || 8787);
    await startServer(port);
  } catch (err) {
    const msg = "Server startup failed: " + (err?.stack || err?.message || err);
    // Write crash log to file (pull with: adb pull /sdcard/Android/data/com.hiwebtalk.android/files/.crash.log)
    const crashPath = path.join(process.env.HI_WEB_TALK_DATA_DIR, ".crash.log");
    await fs.writeFile(crashPath, msg + "\n").catch(() => {});
    process.exitCode = 1;
  }
}
start();
