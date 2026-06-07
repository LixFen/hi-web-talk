/**
 * 抽象基类：统一 LLM Adapter 的公共逻辑
 *
 * 子类只需实现 doCall(messages) 和 doStream(messages, onChunk)，
 * 返回值构造、重试、凭证/配置访问由基类提供。
 */
export class BaseLLMAdapter {
  constructor(modelConfig, credential) {
    this.modelConfig = modelConfig;
    this.credential = credential;
  }

  /**
   * 统一调用入口（含 5xx 指数退避重试）
   */
  async call({ messages }) {
    return this.withRetry(() => this.doCall(messages));
  }

  /**
   * 统一流式入口
   */
  async stream({ messages, onChunk }) {
    return this.doStream(messages, onChunk);
  }

  /**
   * 子类实现：非流式调用
   */
  async doCall(_messages) {
    throw new Error("doCall() not implemented");
  }

  /**
   * 子类实现：流式调用
   */
  async doStream(_messages, _onChunk) {
    throw new Error("doStream() not implemented");
  }

  /**
   * 5xx 指数退避重试（最多 maxAttempts 次）
   */
  async withRetry(fn, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.status || err.statusCode || err.response?.status;
        const isRetryable = status && status >= 500;
        if (attempt === maxAttempts - 1 || !isRetryable) {
          throw err;
        }
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * 标准化返回值构造
   */
  buildResult({ reply, reasoning, usage, responseId }) {
    return {
      reply: (reply || "").trim(),
      reasoning: (reasoning || "").trim(),
      usage: usage || { input: 0, output: 0, total: 0 },
      provider: this.modelConfig.providerType,
      providerType: this.modelConfig.providerType,
      model: this.modelConfig.modelName,
      responseId: responseId ?? null,
    };
  }
}
