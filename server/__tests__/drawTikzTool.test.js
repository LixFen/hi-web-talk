import { describe, expect, it } from "vitest";
import { execute, validateTikzInput } from "../services/tools/drawTikzTool.js";

describe("draw_tikz input boundary", () => {
  it("rejects file/process primitives and unknown packages", () => {
    expect(validateTikzInput("\\input{secret}", {})).toMatch(/不允许/);
    expect(validateTikzInput("\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}", {
      shellesc: "",
    })).toMatch(/不允许加载/);
  });

  it("honors cancellation before starting the renderer", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(execute({ tikzCode: "\\draw (0,0)--(1,1);" }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
