/**
 * 搜索 API 提供商配置
 *
 * 通过环境变量配置：
 *   SEARCH_ENGINE=brave|bing|google|searxng
 *   BRAVE_API_KEY=xxx
 *   BING_API_KEY=xxx
 *   GOOGLE_API_KEY=xxx & GOOGLE_CSE_ID=xxx
 *   SEARXNG_URL=http://localhost:8888
 */

export const searchEngine = process.env.SEARCH_ENGINE || "brave";

export const braveConfig = {
  apiKey: process.env.BRAVE_API_KEY || "",
  baseUrl: "https://api.search.brave.com/res/v1/web/search",
};

export const bingConfig = {
  apiKey: process.env.BING_API_KEY || "",
  baseUrl: "https://api.bing.microsoft.com/v7.0/search",
};

export const googleConfig = {
  apiKey: process.env.GOOGLE_API_KEY || "",
  cseId: process.env.GOOGLE_CSE_ID || "",
  baseUrl: "https://www.googleapis.com/customsearch/v1",
};

export const searxngConfig = {
  baseUrl: process.env.SEARXNG_URL || "http://localhost:8888",
};
