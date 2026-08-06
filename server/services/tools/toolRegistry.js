/**
 * Tool Registry — 工具注册表
 *
 * 管理所有可用工具的定义和执行器。
 * adapter 层通过此注册表获取工具定义和执行函数。
 */

const tools = new Map();

/**
 * 注册一个工具
 * @param {Object} tool
 * @param {Object} tool.definition - OpenAI function calling 格式的工具定义
 * @param {Function} tool.execute - 工具执行函数，接收参数，返回结果
 */
export function registerTool(tool) {
  const name = tool?.definition?.function?.name || tool?.definition?.name;
  if (!name || typeof tool.execute !== "function") {
    throw new Error("Invalid tool: must have definition.function.name and execute function");
  }
  tools.set(name, tool);
}

/**
 * 获取所有工具的定义（用于传给 LLM）
 * @param {string[]|null} names - 可选的工具名称白名单
 * @returns {Array} OpenAI function calling 格式的工具定义列表
 */
export function getToolDefinitions(names = null) {
  const registeredTools = names == null
    ? [...tools.values()]
    : names
        .map((name) => tools.get(name))
        .filter(Boolean);

  return registeredTools.map((t) => t.definition);
}

/**
 * 获取工具执行器
 * @param {string} name - 工具名称
 * @returns {Function|undefined}
 */
export function getToolExecutor(name) {
  return tools.get(name)?.execute;
}

/**
 * 获取工具定义（按名称）
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getToolDefinition(name) {
  return tools.get(name)?.definition;
}

/**
 * 检查是否有注册的工具
 * @returns {boolean}
 */
export function hasTools() {
  return tools.size > 0;
}

/**
 * 获取所有已注册工具的名称
 * @returns {string[]}
 */
export function listToolNames() {
  return [...tools.keys()];
}
