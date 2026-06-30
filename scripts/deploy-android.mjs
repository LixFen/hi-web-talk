import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ANDROID_NODE = path.join(ROOT, "android-node");
const PUBLIC_DIR = path.join(ROOT, "android", "app", "src", "main", "assets", "public");
const PUBLIC_NODE = path.join(PUBLIC_DIR, "nodejs-project");
const SERVER_SRC = path.join(ROOT, "server");

const SKIP_SERVER_FILES = new Set([
  "migrateLegacyData.js",
  "migrateProviderModelSplit.js",
]);

async function copyDir(src, dest, filter = () => true) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (!filter(entry)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, filter);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  console.log("=== Deploying Android Node.js project ===");

  // 1. Copy server files
  console.log("\n1. Copying server/ → android-node/server/");
  const serverDest = path.join(ANDROID_NODE, "server");
  await fs.rm(serverDest, { recursive: true, force: true });
  await copyDir(SERVER_SRC, serverDest, (entry) =>
    !SKIP_SERVER_FILES.has(entry.name) && entry.name !== "node_modules"
  );

  // 2. Install dependencies
  console.log("\n2. Installing npm dependencies in android-node/");
  execSync("npm install --ignore-scripts", {
    cwd: ANDROID_NODE,
    stdio: "inherit",
  });

  // 3. Remove native modules that slipped through
  const nativeModules = ["better-sqlite3"];
  for (const mod of nativeModules) {
    const modPath = path.join(ANDROID_NODE, "node_modules", mod);
    await fs.rm(modPath, { recursive: true, force: true }).catch(() => {});
  }

  // 4. Copy to Capacitor public directory
  console.log("\n3. Copying android-node/ → public/nodejs-project/");
  await fs.rm(PUBLIC_NODE, { recursive: true, force: true });

  // Copy everything except node_modules (handle separately for symlinks)
  const androidNodeEntries = await fs.readdir(ANDROID_NODE, { withFileTypes: true });
  for (const entry of androidNodeEntries) {
    if (entry.name === "node_modules") continue;
    const srcPath = path.join(ANDROID_NODE, entry.name);
    const dstPath = path.join(PUBLIC_NODE, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.copyFile(srcPath, dstPath);
    }
  }
  // Copy node_modules separately
  await copyDir(
    path.join(ANDROID_NODE, "node_modules"),
    path.join(PUBLIC_NODE, "node_modules")
  );

  // 5. Copy frontend dist into nodejs-project for Express to serve
  const distSrc = path.join(ROOT, "dist");
  const distDst = path.join(PUBLIC_NODE, "dist");
  if (await fs.stat(distSrc).then(() => true).catch(() => false)) {
    console.log("\n4. Copying dist/ → nodejs-project/dist/");
    await fs.rm(distDst, { recursive: true, force: true });
    await copyDir(distSrc, distDst);
  }

  // 6. Create loading page for WebView (replaces the React app as the initial view)
  console.log("\n5. Creating loading page → public/index.html");
  await fs.writeFile(
    path.join(PUBLIC_DIR, "index.html"),
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Hi Web Talk</title>
<script src="cordova.js"></script>
<script>
// Navigate to the Express server (with fixed delay to let it start)
function go() {
  window.location.replace("http://127.0.0.1:8787/");
}

// Wait for bridge ready + extra delay for Express, with hard fallback
if (window.Capacitor) {
  try {
    Capacitor.Plugins.CapacitorNodeJS.whenReady().then(function () {
      setTimeout(go, 3000);
    });
  } catch (e) {}
}
// Hard fallback: regardless of bridge, try after 8 seconds
setTimeout(go, 8000);
</script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #111112; color: #aaa; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; flex-direction: column; gap: 24px; }
.spinner { width: 36px; height: 36px; border: 3px solid #222; border-top-color: #4CAF50; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
h2 { color: #eee; font-weight: 400; font-size: 18px; }
p { font-size: 13px; color: #666; }
#dots { font-family: monospace; letter-spacing: 4px; }
</style>
</head>
<body>
<div class="spinner"></div>
<h2>Hi Web Talk</h2>
<p id="status">Starting server<span id="dots"></span></p>
</body>
</html>`
  );

  console.log("\n=== Deploy complete ===");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
