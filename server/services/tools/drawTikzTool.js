import { registerTool } from "./toolRegistry.js";
import sharp from "sharp";
import * as tikz from "node-tikzjax";

let loaded = false;
let compileQueue = Promise.resolve();

const MAX_TIKZ_CODE_LENGTH = 50_000;
const MAX_PACKAGE_COUNT = 8;
const MAX_PACKAGE_OPTIONS_LENGTH = 128;
const MAX_RENDERED_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_RENDERED_SVG_LENGTH = 2 * 1024 * 1024;
const DRAW_TIMEOUT_MS = 30_000;
const ALLOWED_PACKAGES = new Set([
  "amsmath",
  "amssymb",
  "amsfonts",
  "circuitikz",
  "graphicx",
  "mathtools",
  "pgfplots",
  "xcolor",
]);

async function ensureLoaded() {
  if (!loaded) {
    await tikz.load();
    loaded = true;
  }
}

async function withCompileLock(action) {
  let release;
  const previous = compileQueue;
  compileQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function createAbortError(message = "TikZ 编译已取消") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function waitForCompilation(promise, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`TikZ 编译超时（>${timeoutMs}ms）`)));
    }, timeoutMs);

    const onAbort = () => {
      finish(() => reject(createAbortError()));
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function validateTikzInput(tikzCode, packages) {
  if (!tikzCode || typeof tikzCode !== "string") {
    return "tikzCode 参数无效";
  }

  if (tikzCode.length > MAX_TIKZ_CODE_LENGTH) {
    return `tikzCode 过长，最多允许 ${MAX_TIKZ_CODE_LENGTH} 个字符`;
  }

  // node-tikzjax uses an in-memory TeX filesystem. Explicit file I/O and
  // shell escape commands are still rejected so future renderer changes do
  // not accidentally turn model output into a file/process primitive.
  if (/\\(?:input|include|openin|openout|write18|read|readline|catcode)\b/i.test(tikzCode)) {
    return "TikZ 代码包含不允许的文件或进程操作命令";
  }

  if (packages == null) return null;
  if (typeof packages !== "object" || Array.isArray(packages)) {
    return "packages 参数无效";
  }

  const packageEntries = Object.entries(packages);
  if (packageEntries.length > MAX_PACKAGE_COUNT) {
    return `最多允许加载 ${MAX_PACKAGE_COUNT} 个 LaTeX 包`;
  }

  for (const [name, options] of packageEntries) {
    if (!ALLOWED_PACKAGES.has(name)) {
      return `不允许加载 LaTeX 包: ${name}`;
    }
    if (typeof options !== "string" || options.length > MAX_PACKAGE_OPTIONS_LENGTH) {
      return `LaTeX 包 ${name} 的选项无效或过长`;
    }
  }

  return null;
}

const drawTikzDefinition = {
  type: "function",
  function: {
    name: "draw_tikz",
    description:
      "根据用户需求绘制 TikZ 图形。可用的 TikZ 库和 LaTeX 包：tikz 基础库默认已加载；circuitikz（电路图）、pgfplots（函数图）、amsmath/amssymb（数学符号）等可通过 packages 参数加载。注意：多次调用会覆写上一次的绘制结果，不可用中文。图形正常绘制后，调用 check_drawing来观察绘制结果。",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "描述了要绘制的图形内容和意图",
        },
        tikzCode: {
          type: "string",
          description: "完整的 TikZ 代码，从 \\begin{tikzpicture} 到 \\end{tikzpicture}",
        },
        packages: {
          type: "object",
          description: "需要额外加载的 LaTeX 包，键为包名，值为选项字符串（无选项则传空字符串）。例如 {\"circuitikz\": \"\", \"pgfplots\": \"\"}",
          additionalProperties: { type: "string" },
        },
      },
      required: ["description", "tikzCode"],
    },
  },
};

let artIdCounter = 0;
function nextArtifactId() {
  return `art_${Date.now().toString(36)}_${(++artIdCounter).toString(36)}`;
}

async function execute({ description, tikzCode, packages }, { signal } = {}) {
  const validationError = validateTikzInput(tikzCode, packages);
  if (validationError) {
    return { toolResult: { error: validationError, compiled: false }, artifacts: [] };
  }
  throwIfAborted(signal);

  let source = tikzCode;
  if (!source.includes("\\begin{tikzpicture}")) {
    source = `\\begin{tikzpicture}\n${source}\n\\end{tikzpicture}`;
  }

  if (!source.includes("\\begin{document}")) {
    source = `\\begin{document}\n${source}\n\\end{document}`;
  }

  const texPackages = {};
  if (packages && typeof packages === "object") {
    for (const [name, opts] of Object.entries(packages)) {
      texPackages[name] = opts || null;
    }
  }

  let logs = [];
  try {
    return await withCompileLock(async () => {
      throwIfAborted(signal);
      await ensureLoaded();

      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(" "));

      try {
        const dvi = await waitForCompilation(
          tikz.tex(source, { texPackages, showConsole: true }),
          signal,
          DRAW_TIMEOUT_MS,
        );
        const svg = await waitForCompilation(
          tikz.dvi2svg(dvi),
          signal,
          DRAW_TIMEOUT_MS,
        );
        if (typeof svg !== "string" || svg.length > MAX_RENDERED_SVG_LENGTH) {
          throw new Error(`TikZ SVG 过大，最多允许 ${MAX_RENDERED_SVG_LENGTH} 个字符`);
        }

        const pngBuffer = await waitForCompilation(
          sharp(Buffer.from(svg))
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer(),
          signal,
          DRAW_TIMEOUT_MS,
        );
        if (pngBuffer.length > MAX_RENDERED_IMAGE_BYTES) {
          throw new Error(`TikZ 图片过大，最多允许 ${MAX_RENDERED_IMAGE_BYTES} 字节`);
        }

        const pngBase64 = pngBuffer.toString("base64");
        const artifactId = nextArtifactId();

        return {
          toolResult: {
            artifactId,
            tikzCode: source,
            compiled: true,
          },
          artifacts: [
            {
              id: artifactId,
              type: "image",
              mime: "image/png",
              contextPolicy: "preserve",
              label: "[绘制的图形]",
              data: pngBase64,
              // SVG is returned separately in tikzInfo for the UI. Keeping it
              // out of the preserved artifact avoids storing it twice.
              meta: { svg },
            },
          ],
        };
      } finally {
        console.log = originalLog;
      }
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    const errorDetail = err.message;
    const texError = logs.find((l) => l.includes("! ")) || "";
    return {
      toolResult: {
        tikzCode: source,
        compiled: false,
        error: `TikZ 编译失败: ${texError || errorDetail}`,
      },
      artifacts: [],
    };
  }
}

registerTool({
  definition: drawTikzDefinition,
  execute,
});

export { drawTikzDefinition, execute, validateTikzInput };
