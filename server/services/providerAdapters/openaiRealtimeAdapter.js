/**
 * OpenAI Realtime API Adapter (预留/二期)
 *
 * OpenAI Realtime API 基于 WebSocket (wss://api.openai.com/v1/realtime)
 * 用于低延迟音频/实时对话。当前仅预留接口结构，不实现完整逻辑。
 */

export function createOpenAIRealtimeAdapter(_modelConfig, _credential) {
  async function call() {
    throw new Error("OpenAI Realtime API 暂不支持非流式调用，请使用 WebSocket 模式。");
  }

  async function stream() {
    throw new Error("OpenAI Realtime API 流式模式尚未实现。");
  }

  function supportsRealtime() {
    return true;
  }

  async function realtimeConnect() {
    throw new Error("OpenAI Realtime API 连接尚未实现。");
  }

  return { call, stream, supportsRealtime, realtimeConnect };
}
