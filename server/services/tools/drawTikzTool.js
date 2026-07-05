import { registerTool } from "./toolRegistry.js";
import sharp from "sharp";
import * as tikz from "node-tikzjax";

let loaded = false;
async function ensureLoaded() {
  if (!loaded) {
    await tikz.load();
    loaded = true;
  }
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

async function execute({ description, tikzCode, packages }) {
  if (!tikzCode || typeof tikzCode !== "string") {
    return { toolResult: { error: "tikzCode 参数无效", compiled: false }, artifacts: [] };
  }

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
    await ensureLoaded();

    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      const dvi = await tikz.tex(source, { texPackages, showConsole: true });
      const svg = await tikz.dvi2svg(dvi);

      const pngBuffer = await sharp(Buffer.from(svg))
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      const pngBase64 = pngBuffer.toString("base64");

      return {
        toolResult: {
          tikzCode: source,
          compiled: true,
        },
        artifacts: [
          {
            id: nextArtifactId(),
            type: "image",
            mime: "image/png",
            contextPolicy: "preserve",
            label: "[绘制的图形]",
            data: pngBase64,
            meta: { svg },
          },
        ],
      };
    } finally {
      console.log = originalLog;
    }
  } catch (err) {
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

export { drawTikzDefinition, execute };
