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
      "根据用户需求绘制 TikZ 图形。调用后系统会自动编译并展示渲染结果供用户检查。可用的 TikZ 库和 LaTeX 包：tikz 基础库默认已加载；circuitikz（电路图）、pgfplots（函数图）、amsmath/amssymb（数学符号）等可通过 packages 参数加载。确认正确后请调用 check_drawing 记录确认状态。注意：多次调用会覆写上一次的绘制结果。",
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

async function execute({ description, tikzCode, packages }) {
  if (!tikzCode || typeof tikzCode !== "string") {
    return { error: "tikzCode 参数无效", compiled: false };
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

      const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const pngBase64 = pngBuffer.toString("base64");

      return {
        tikzCode: source,
        svg,
        pngBase64,
        compiled: true,
      };
    } finally {
      console.log = originalLog;
    }
  } catch (err) {
    const errorDetail = err.message;
    const texError = logs.find((l) => l.includes("! ")) || "";
    return {
      tikzCode: source,
      svg: null,
      compiled: false,
      error: `TikZ 编译失败: ${texError || errorDetail}`,
    };
  }
}

registerTool({
  definition: drawTikzDefinition,
  execute,
});

export { drawTikzDefinition, execute };
