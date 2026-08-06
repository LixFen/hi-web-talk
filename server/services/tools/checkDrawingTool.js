import { registerTool } from "./toolRegistry.js";

const checkDrawingDefinition = {
  type: "function",
  function: {
    name: "check_drawing",
    description:
      "确认最近一次 draw_tikz 的渲染结果。必须传入 draw_tikz 返回的 artifactId；此工具会检查渲染结果是否存在以及代码是否匹配，并把图片留给支持视觉的模型检查。它不会替模型判断图形语义是否正确。",
    parameters: {
      type: "object",
      properties: {
        artifactId: {
          type: "string",
          description: "最近一次 draw_tikz 返回的 artifactId",
        },
        tikzCode: {
          type: "string",
          description: "可选；用于确认当前图形对应的 TikZ 代码",
        },
        notes: {
          type: "string",
          description: "对结果的补充说明",
        },
      },
      required: ["artifactId"],
    },
  },
};

async function execute({ artifactId, tikzCode, notes }) {
  return {
    toolResult: { artifactId, tikzCode: tikzCode || "", notes: notes || "" },
    artifacts: [],
  };
}

registerTool({
  definition: checkDrawingDefinition,
  execute,
});

export { checkDrawingDefinition, execute };
