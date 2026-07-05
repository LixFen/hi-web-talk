/**
 * Web Search Tool — 联网搜索工具
 *
 * 注册到 toolRegistry，供 adapter 层在 tool calling 循环中调用。
 */

import { registerTool } from "./toolRegistry.js";
import { webSearch } from "../webSearchService.js";

// ponytail: module-level config, set per-request. Node single-threaded, no race.
let preferredEngine = null;
let preferredProviderConfigs = {};

export function setPreferredEngine(engine) {
  preferredEngine = engine;
}

export function setPreferredProviderConfigs(configs) {
  preferredProviderConfigs = configs || {};
}

const webSearchDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "搜索互联网获取最新的实时信息。当用户询问实时性问题（天气、新闻、股价、赛事结果等）或需要验证最新信息时使用此工具。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "优化后的搜索关键词，应简洁且包含关键信息",
        },
      },
      required: ["query"],
    },
  },
};

/**
 * 执行搜索工具
 * @param {Object} args
 * @param {string} args.query - 搜索关键词
 * @returns {Promise<Object>} 搜索结果
 */
async function execute({ query }) {
  if (!query || typeof query !== "string") {
    return { toolResult: { error: "query 参数无效", sources: [] }, artifacts: [] };
  }

  try {
    const result = await webSearch(query.trim(), {
      maxResults: 5,
      fetchContent: true,
      engine: preferredEngine || undefined,
      providerConfigs: preferredProviderConfigs,
    });

    return {
      toolResult: {
        query: result.query,
        engine: result.engine,
        sources: result.sources.map((s) => ({
          title: s.title,
          url: s.url,
          snippet: s.snippet,
          content: s.content || "",
        })),
      },
      artifacts: [],
    };
  } catch (err) {
    return {
      toolResult: {
        query: query,
        engine: preferredEngine,
        error: err.message,
        sources: [],
      },
      artifacts: [],
    };
  }
}

// 注册工具
registerTool({
  definition: webSearchDefinition,
  execute,
});

export { webSearchDefinition, execute };
