import { registerTool } from "./toolRegistry.js";

const checkDrawingDefinition = {
  type: "function",
  function: {
    name: "check_drawing",
    description:
      "记录 LLM 对 TikZ 图形正确性的确认状态。系统会返回最近一次渲染的 SVG 图片供 LLM 自检（多模态模型可额外看到 PNG）。如果没有先调用 draw_tikz 会返回错误提示，请先绘制。",
    parameters: {
      type: "object",
      properties: {
        tikzCode: {
          type: "string",
          description: "最终确认的 TikZ 代码",
        },
        isCorrect: {
          type: "boolean",
          description: "渲染结果是否正确",
        },
        notes: {
          type: "string",
          description: "对结果的补充说明",
        },
      },
      required: ["tikzCode", "isCorrect"],
    },
  },
};

async function execute({ tikzCode, isCorrect, notes }) {
  return {
    tikzCode,
    isCorrect: Boolean(isCorrect),
    notes: notes || "",
  };
}

registerTool({
  definition: checkDrawingDefinition,
  execute,
});

export { checkDrawingDefinition, execute };
