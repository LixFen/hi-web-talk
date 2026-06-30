/**
 * 搜索 API 提供商配置
 *
 * 通过环境变量配置：
 *   SEARCH_ENGINE=brave|bing|google|searxng
 *   BRAVE_API_KEY=xxx
 *   BING_API_KEY=xxx
 *   GOOGLE_API_KEY=xxx & GOOGLE_CSE_ID=xxx
 *   SEARXNG_URL=http://localhost:8888
 *
 * 也支持通过 appSettings.searchProviderConfigs 动态覆盖。
 */

export const searchEngine = process.env.SEARCH_ENGINE || "bing_html";

function envOr(envKey, fallback = "") {
  return process.env[envKey] || fallback;
}

export function buildBraveConfig(userOverrides = {}) {
  return {
    apiKey: userOverrides.apiKey || envOr("BRAVE_API_KEY"),
    baseUrl: "https://api.search.brave.com/res/v1/web/search",
  };
}

export function buildBingConfig(userOverrides = {}) {
  return {
    apiKey: userOverrides.apiKey || envOr("BING_API_KEY"),
    baseUrl: "https://api.bing.microsoft.com/v7.0/search",
  };
}

export function buildGoogleConfig(userOverrides = {}) {
  return {
    apiKey: userOverrides.apiKey || envOr("GOOGLE_API_KEY"),
    cseId: userOverrides.cseId || envOr("GOOGLE_CSE_ID"),
    baseUrl: "https://www.googleapis.com/customsearch/v1",
  };
}

export function buildSearxngConfig(userOverrides = {}) {
  return {
    baseUrl: userOverrides.baseUrl || envOr("SEARXNG_URL", "http://localhost:8888"),
  };
}

export const bingHtmlConfig = {
  baseUrl: "https://www.bing.com/search",
};
