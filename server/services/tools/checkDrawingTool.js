import { registerTool } from "./toolRegistry.js";

const checkDrawingDefinition = {
  type: "function",
  function: {
    name: "check_drawing",
    description:
      "使用此工具来检查绘制的图片。如果没有先调用 draw_tikz 会返回错误提示，请先绘制。",
    parameters: {
      type: "object",
      properties: {
        tikzCode: {
          type: "string",
          description: "最终确认的 TikZ 代码",
        },
        notes: {
          type: "string",
          description: "对结果的补充说明",
        },
      },
      required: ["tikzCode"],
    },
  },
};

async function execute({ tikzCode, notes }) {
  return {
    toolResult: { tikzCode, notes: notes || "" },
    artifacts: [],
  };
}

registerTool({
  definition: checkDrawingDefinition,
  execute,
});

export { checkDrawingDefinition, execute };
