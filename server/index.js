import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { DEFAULT_SYSTEM_PROMPT, JWT_SECRET, JWT_EXPIRES_IN } from "./constants.js";
import { getDatabase } from "./lib/database.js";
import { authenticateToken, requireSessionOwnership } from "./middleware/auth.js";
import { loginUser, registerUser, getUserById } from "./services/userService.js";
import { readSessionRecord } from "./lib/database.js";
import {
  listAdaptationDefinitions,
  listBlockAdaptations,
  listSessionAdaptations,
  upsertBlockAdaptation,
} from "./services/blockAdaptationService.js";
import {
  createDialogueBlock,
  readBlock,
} from "./services/blockGraphService.js";
import { buildContextForActiveBlock } from "./services/contextBuilderService.js";
import {
  appendErrorLog,
  listErrorLogs,
} from "./services/errorLogService.js";
import { callProviderModel, streamProviderModel } from "./services/llmProviderService.js";
import {
  createModel,
  deleteModel,
  getAppSettings,
  getModelByAlias,
  getModelHealthReport,
  listModelProviderDefinitions,
  listModels,
  updateAppSettings,
  updateModel,
} from "./services/modelConfigService.js";
import {
  createSession,
  deleteSession,
  ensureDataLayout,
  getSessionDetail,
  getSessionOrThrow,
  getSuggestedSessionTitle,
  listSessions,
  updateSession,
  updateSessionTitle,
  setActiveBlock,
  updateSessionFocusedBlock,
  updateSessionViewState,
} from "./services/sessionService.js";
import {
  generateSummaryForBlock,
  getSummaryByBlockSHA1,
  listSummaries,
  updateSummaryStatus,
} from "./services/summaryService.js";

const app = express();
const port = Number(process.env.OPENAI_PORT || 8787);
const maxPortAttempts = Number(process.env.OPENAI_PORT_ATTEMPTS || 10);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  }),
);

const corsOriginRaw = process.env.CORS_ORIGIN || "http://localhost:5173";

const corsOrigin = corsOriginRaw.split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(
  cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin || corsOrigin.includes(requestOrigin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试。" },
});

app.use("/api", apiLimiter);
app.use(express.json({ limit: "1mb" }));

app.post("/api/auth/register", async (request, response) => {
  try {
    const { username, password } = request.body ?? {};
    const result = await registerUser(username, password);
    response.status(201).json(result);
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "注册失败。",
    });
  }
});

app.post("/api/auth/login", async (request, response) => {
  try {
    const { username, password } = request.body ?? {};
    const result = await loginUser(username, password);
    response.json(result);
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "登录失败。",
    });
  }
});

app.get("/api/auth/me", authenticateToken, async (request, response) => {
  try {
    const user = getUserById(request.user.id);
    if (!user) {
      response.status(401).json({ error: "用户不存在。" });
      return;
    }
    response.json({
      user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
    });
  } catch (error) {
    response.status(500).json({ error: "获取用户信息失败。" });
  }
});

function parseModelPayload(body = {}) {
  return {
    alias: body.alias,
    label: body.label,
    providerType: body.providerType,
    baseURL: body.baseURL,
    apiKeySource: body.apiKeySource,
    apiKeyEnvName: body.apiKeyEnvName,
    apiKeyEncrypted: body.apiKeyEncrypted,
    apiKey: body.apiKey,
    modelName: body.modelName,
    enabled: body.enabled,
    supportsStreaming: body.supportsStreaming,
    systemPromptRole: body.systemPromptRole,
    requestOptions: body.requestOptions,
    isPreset: body.isPreset,
    meta: body.meta,
  };
}

async function tryAppendErrorLog(payload) {
  if (!payload?.sessionHash) {
    return;
  }

  try {
    await getSessionOrThrow(payload.sessionHash);
    await appendErrorLog(payload);
  } catch {
    // Ignore secondary logging failures so the primary request error stays intact.
  }
}

function writeSSE(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeRawSSE(response, data) {
  response.write(`data: ${data}\n\n`);
}

function writeDoneSSE(response) {
  response.write("data: [DONE]\n\n");
}

function prepareSSE(response) {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
}

const STREAM_VERBOSE = process.env.STREAM_VERBOSE === "true";
const NOISY_STREAM_STAGES = new Set([
  "delta-sent",
  "delta-skipped-closed",
]);

function logStream(stage, payload = null) {
  if (!STREAM_VERBOSE && NOISY_STREAM_STAGES.has(stage)) {
    return;
  }

  const timestamp = new Date().toISOString();

  if (payload === null) {
    console.log(`[stream] ${timestamp} ${stage}`);
    return;
  }

  console.log(`[stream] ${timestamp} ${stage}`, payload);
}

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    models: await getModelHealthReport(),
  });
});

app.get("/api/model-provider-definitions", (_request, response) => {
  response.json({ definitions: listModelProviderDefinitions() });
});

app.get("/api/app-settings", authenticateToken, async (request, response) => {
  response.json({ settings: await getAppSettings(request.user.id) });
});

app.patch("/api/app-settings", authenticateToken, async (request, response) => {
  try {
    const settings = await updateAppSettings(request.body ?? {}, request.user.id);
    response.json({ settings });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "更新应用设置失败。",
    });
  }
});

app.get("/api/models", authenticateToken, async (request, response) => {
  const models = await listModels(request.user.id, request.user.role);
  response.json({ models });
});

app.post("/api/models", authenticateToken, async (request, response) => {
  try {
    const model = await createModel(parseModelPayload(request.body), request.user.id, request.user.role);
    const models = await listModels(request.user.id, request.user.role);
    response.status(201).json({
      model: models.find((item) => item.alias === model.alias) ?? null,
      models,
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "创建模型失败。",
    });
  }
});

app.put("/api/models/:alias", authenticateToken, async (request, response) => {
  try {
    const model = await updateModel(request.params.alias, parseModelPayload(request.body), request.user.id, request.user.role);
    const models = await listModels(request.user.id, request.user.role);
    response.json({
      model: models.find((item) => item.alias === model.alias) ?? null,
      models,
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "更新模型失败。",
    });
  }
});

app.delete("/api/models/:alias", authenticateToken, async (request, response) => {
  try {
    const deleted = await deleteModel(request.params.alias, request.user.id, request.user.role);
    const models = await listModels(request.user.id, request.user.role);
    response.json({
      deletedAlias: deleted.alias,
      models,
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "删除模型失败。",
    });
  }
});

app.get("/api/adaptation-definitions", (_request, response) => {
  response.json({ definitions: listAdaptationDefinitions() });
});

app.get("/api/sessions", authenticateToken, async (request, response) => {
  const sessions = await listSessions(request.user.id);
  response.json({ sessions });
});

app.post("/api/sessions", authenticateToken, async (request, response) => {
  const detail = await createSession(request.user.id);
  response.status(201).json(detail);
});

app.delete("/api/sessions/:sessionHash", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const result = await deleteSession(request.params.sessionHash);
    response.json({
      ...result,
      sessions: await listSessions(request.user.id),
    });
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "删除会话失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const detail = await getSessionDetail(request.params.sessionHash);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "读取会话失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const title = `${request.body?.title ?? ""}`.trim();

  if (!title) {
    response.status(400).json({ error: "session title 不能为空。" });
    return;
  }

  try {
    const detail = await updateSessionTitle(request.params.sessionHash, title);
    response.json(detail);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新会话名称失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash/view-state", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const partialViewState = {};

    if (Object.prototype.hasOwnProperty.call(request.body ?? {}, "mode")) {
      partialViewState.mode = request.body?.mode;
    }

    if (Object.prototype.hasOwnProperty.call(request.body ?? {}, "focusedBlockSHA1")) {
      partialViewState.focusedBlockSHA1 = request.body?.focusedBlockSHA1;
    }

    const detail = await updateSessionViewState(request.params.sessionHash, partialViewState);
    response.json(detail);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新视图状态失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash/focused-block", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const { focusedBlockSHA1 } = request.body ?? {};

  if (!focusedBlockSHA1) {
    response.status(400).json({ error: "focusedBlockSHA1 不能为空。" });
    return;
  }

  try {
    const result = await updateSessionFocusedBlock(
      request.params.sessionHash,
      focusedBlockSHA1,
    );
    response.json(result);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新焦点失败。",
    });
  }
});

app.post("/api/sessions/:sessionHash/active-block", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const { blockSHA1 } = request.body ?? {};

  if (!blockSHA1) {
    response.status(400).json({ error: "blockSHA1 不能为空。" });
    return;
  }

  try {
    const detail = await setActiveBlock(request.params.sessionHash, blockSHA1);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "切换 active block 失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/adaptations", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const adaptations = await listSessionAdaptations(request.params.sessionHash);
    response.json({ adaptations });
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "读取适配项失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const adaptations = await listBlockAdaptations(
      request.params.sessionHash,
      request.params.blockSHA1,
    );
    response.json({ adaptations });
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "读取块适配项失败。",
    });
  }
});

app.put("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations/:key", authenticateToken, requireSessionOwnership(), async (request, response) => {
  try {
    const adaptation = await upsertBlockAdaptation(
      request.params.sessionHash,
      request.params.blockSHA1,
      request.params.key,
      {
        enabled: request.body?.enabled,
        status: request.body?.status,
        source: request.body?.source ?? "user",
        config: request.body?.config ?? {},
        payload: request.body?.payload ?? {},
        meta: request.body?.meta ?? {},
      },
    );
    const detail = await getSessionDetail(request.params.sessionHash);

    response.json({ adaptation, detail });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "更新适配项失败。",
    });
  }
});

app.post("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations/:key/run", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const { modelAlias } = request.body ?? {};

  try {
    if (request.params.key !== "summary.generate") {
      response.status(400).json({ error: "这个适配命令暂时还不支持执行。" });
      return;
    }

    const summary = await generateSummaryForBlock(
      request.params.sessionHash,
      request.params.blockSHA1,
      modelAlias,
    );
    const detail = await getSessionDetail(request.params.sessionHash);

    response.status(201).json({ summary, detail });
  } catch (error) {
    const targetBlock = await readBlock(request.params.sessionHash, request.params.blockSHA1);

    await tryAppendErrorLog({
      sessionHash: request.params.sessionHash,
      operation: "adaptation-command",
      parentBlockSHA1: targetBlock?.parentBlockSHA1 ?? null,
      blockSHA1: request.params.blockSHA1,
      prompt: targetBlock?.prompt ?? "",
      modelAlias: modelAlias ?? "",
      error,
      meta: {
        adaptationKey: request.params.key,
      },
    });

    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "执行适配命令失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/summaries", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const summaries = await listSummaries(request.params.sessionHash);
  response.json({ summaries });
});

app.get("/api/sessions/:sessionHash/summaries/:blockSHA1", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const summary = await getSummaryByBlockSHA1(
    request.params.sessionHash,
    request.params.blockSHA1,
  );

  if (!summary) {
    response.status(404).json({ error: "找不到该块的摘要记录。" });
    return;
  }

  response.json({ summary });
});

app.patch("/api/sessions/:sessionHash/summaries/:blockSHA1", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const { status, summary, errorMessage, modelAlias } = request.body ?? {};
  const nextSummary = await updateSummaryStatus(request.params.sessionHash, request.params.blockSHA1, {
    status,
    summary,
    errorMessage,
    modelAlias,
    source: "user",
  });

  response.json({ summary: nextSummary });
});

app.post("/api/sessions/:sessionHash/summaries/:blockSHA1/generate", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const { modelAlias } = request.body ?? {};

  try {
    const summary = await generateSummaryForBlock(
      request.params.sessionHash,
      request.params.blockSHA1,
      modelAlias,
    );
    const detail = await getSessionDetail(request.params.sessionHash);
    response.status(201).json({ summary, detail });
  } catch (error) {
    const targetBlock = await readBlock(request.params.sessionHash, request.params.blockSHA1);

    await tryAppendErrorLog({
      sessionHash: request.params.sessionHash,
      operation: "summary",
      parentBlockSHA1: targetBlock?.parentBlockSHA1 ?? null,
      blockSHA1: request.params.blockSHA1,
      prompt: targetBlock?.prompt ?? "",
      modelAlias: modelAlias ?? "",
      error,
      meta: {
        stage: "generate-summary",
      },
    });

    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "生成摘要失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/errors", authenticateToken, requireSessionOwnership(), async (request, response) => {
  const errors = await listErrorLogs(request.params.sessionHash);
  response.json({ errors });
});

app.post("/api/blocks/:blockSHA1/branch", authenticateToken, async (request, response) => {
  const { sessionHash } = request.body ?? {};

  if (!sessionHash) {
    response.status(400).json({ error: "sessionHash 不能为空。" });
    return;
  }

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  try {
    const detail = await setActiveBlock(sessionHash, request.params.blockSHA1);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "创建分支失败。",
    });
  }
});

app.post("/api/blocks/reply", authenticateToken, async (request, response) => {
  const { sessionHash, prompt, modelAlias } = request.body ?? {};

  if (!sessionHash || !prompt?.trim()) {
    response.status(400).json({ error: "sessionHash 和 prompt 不能为空。" });
    return;
  }

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  try {
    const selectedModel = await getModelByAlias(modelAlias, request.user.id, request.user.role);
    if (!selectedModel || selectedModel.enabled === false) {
      response.status(400).json({ error: "未找到可用的模型配置。" });
      return;
    }

    const context = await buildContextForActiveBlock(sessionHash, session.activeBlockSHA1);
    const providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: prompt.trim() },
    ];

    const result = await callProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
    });

    const block = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: prompt.trim(),
      response: result.reply,
      parentBlockSHA1: session.activeBlockSHA1,
      contextLength: context.contextLength,
      tokenUsage: result.usage,
      meta: {
        providerType: result.providerType,
        model: result.model,
        responseId: result.responseId,
      },
    });

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(prompt, session.title),
      updatedAt: new Date().toISOString(),
      activeBlockSHA1: block.sha1,
    });

    const detail = await getSessionDetail(sessionHash, { summaries: context.summaries, adaptationMap: context.adaptationMap });
    response.status(201).json(detail);
  } catch (error) {
    await tryAppendErrorLog({
      sessionHash,
      operation: "reply",
      parentBlockSHA1: null,
      blockSHA1: null,
      prompt: prompt?.trim() ?? "",
      modelAlias: modelAlias ?? "",
      error,
      meta: {
        stage: "reply",
      },
    });

    response.status(error?.status || 500).json({
      error:
        error instanceof Error
          ? error.message
          : "调用模型接口时出错了，请检查 Key、模型名或网络。",
    });
  }
});

app.post("/api/blocks/reply/stream", authenticateToken, async (request, response) => {
  const { sessionHash, prompt, modelAlias } = request.body ?? {};

  if (!sessionHash || !prompt?.trim()) {
    response.status(400).json({ error: "sessionHash 和 prompt 不能为空。" });
    return;
  }

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  let requestAborted = false;
  let responseFinished = false;
  let responseClosed = false;
  const handleAbort = () => {
    requestAborted = true;
    responseClosed = true;
    logStream("request-close", {
      sessionHash,
      modelAlias,
      writableEnded: response.writableEnded,
      destroyed: response.destroyed,
      responseFinished,
    });
  };
  const handleFinish = () => {
    responseFinished = true;
    logStream("response-finish", { sessionHash, modelAlias });
  };

  request.on("close", handleAbort);
  response.on("finish", handleFinish);

  try {
    logStream("request-start", { sessionHash, modelAlias, promptLength: prompt?.trim?.().length ?? 0 });
    const selectedModel = await getModelByAlias(modelAlias, request.user.id, request.user.role);
    if (!selectedModel || selectedModel.enabled === false) {
      response.status(400).json({ error: "未找到可用的模型配置。" });
      return;
    }

    if (selectedModel.supportsStreaming === false) {
      response.status(400).json({ error: "该模型未启用流式传输，请改用非流式回复接口。" });
      return;
    }

    prepareSSE(response);
    logStream("sse-prepared", { sessionHash, activeBlockSHA1: session.activeBlockSHA1 });

    const context = await buildContextForActiveBlock(sessionHash, session.activeBlockSHA1);
    logStream("context-built", {
      sessionHash,
      contextLength: context.contextLength,
      messageCount: context.messages.length,
    });
    const providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: prompt.trim() },
    ];

    writeRawSSE(response, JSON.stringify({
      type: "start",
      sessionHash,
      modelAlias: selectedModel.alias,
    }));
    logStream("start-sent", { sessionHash, modelAlias: selectedModel.alias });

    const result = await streamProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
      onChunk: async (delta) => {
        if (response.writableEnded || response.destroyed) {
          logStream("delta-skipped-closed", { length: delta.length });
          return;
        }

        writeRawSSE(response, JSON.stringify({
          type: "delta",
          delta,
        }));
        logStream("delta-sent", { length: delta.length, preview: delta.slice(0, 60) });
      },
    });

    logStream("provider-finished", {
      replyLength: result.reply.length,
      responseId: result.responseId,
      usage: result.usage,
    });

    if (response.writableEnded || response.destroyed) {
      logStream("aborted-before-persist", { sessionHash, modelAlias: selectedModel.alias });
      response.end();
      return;
    }

    const block = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: prompt.trim(),
      response: result.reply,
      parentBlockSHA1: session.activeBlockSHA1,
      contextLength: context.contextLength,
      tokenUsage: result.usage,
      meta: {
        providerType: result.providerType,
        model: result.model,
        responseId: result.responseId,
      },
    });

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(prompt, session.title),
      updatedAt: new Date().toISOString(),
      activeBlockSHA1: block.sha1,
    });
    logStream("session-updated", { sessionHash, blockSHA1: block.sha1 });

    const detail = await getSessionDetail(sessionHash, { summaries: context.summaries, adaptationMap: context.adaptationMap });
    logStream("detail-ready", {
      sessionHash,
      messageCount: detail.messages.length,
      activeBlockSHA1: detail.graph?.activeBlockSHA1,
    });
    writeRawSSE(response, JSON.stringify({
      type: "complete",
      detail,
    }));
    logStream("complete-sent", { sessionHash });
    writeDoneSSE(response);
    logStream("done-sent", { sessionHash });
    response.end();
  } catch (error) {
    logStream("error", {
      sessionHash,
      modelAlias,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await tryAppendErrorLog({
      sessionHash,
      operation: "reply-stream",
      parentBlockSHA1: null,
      blockSHA1: null,
      prompt: prompt?.trim() ?? "",
      modelAlias: modelAlias ?? "",
      error,
      meta: {
        stage: "reply-stream",
      },
    });

    if (!response.headersSent) {
      response.status(error?.status || 500).json({
        error:
          error instanceof Error
            ? error.message
            : "调用模型接口时出错了，请检查 Key、模型名或网络。",
      });
      return;
    }

    writeRawSSE(response, JSON.stringify({
      type: "error",
      error:
        error instanceof Error
          ? error.message
          : "调用模型接口时出错了，请检查 Key、模型名或网络。",
    }));
    writeDoneSSE(response);
    response.end();
  } finally {
    request.off("close", handleAbort);
    response.off("finish", handleFinish);
  }
});

app.post("/api/blocks/:blockSHA1/regenerate", authenticateToken, async (request, response) => {
  const { sessionHash, modelAlias } = request.body ?? {};

  if (!sessionHash) {
    response.status(400).json({ error: "sessionHash 不能为空。" });
    return;
  }

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  let targetBlock = null;

  try {
    targetBlock = await readBlock(sessionHash, request.params.blockSHA1);

    if (!targetBlock || targetBlock.blockType !== "dialogue") {
      response.status(404).json({ error: "找不到可重生成的对话块。" });
      return;
    }

    const selectedModel = await getModelByAlias(modelAlias || targetBlock.modelAlias, request.user.id, request.user.role);

    if (!selectedModel || selectedModel.enabled === false) {
      response.status(400).json({ error: "未找到可用的模型配置。" });
      return;
    }

    const parentBlockSHA1 = targetBlock.parentBlockSHA1;
    const context = parentBlockSHA1
      ? await buildContextForActiveBlock(sessionHash, parentBlockSHA1)
      : { messages: [], contextLength: 0 };
    const providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: targetBlock.prompt },
    ];

    const result = await callProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
    });

    const regeneratedBlock = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: targetBlock.prompt,
      response: result.reply,
      parentBlockSHA1,
      contextLength: context.contextLength,
      tokenUsage: result.usage,
      meta: {
        providerType: result.providerType,
        model: result.model,
        responseId: result.responseId,
        regeneratedFromBlockSHA1: targetBlock.sha1,
      },
    });

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(targetBlock.prompt, session.title),
      updatedAt: new Date().toISOString(),
      activeBlockSHA1: regeneratedBlock.sha1,
    });

    const detail = await getSessionDetail(sessionHash, { summaries: context.summaries, adaptationMap: context.adaptationMap });
    response.status(201).json(detail);
  } catch (error) {
    await tryAppendErrorLog({
      sessionHash,
      operation: "regenerate",
      parentBlockSHA1: targetBlock?.parentBlockSHA1 ?? null,
      blockSHA1: request.params.blockSHA1,
      prompt: targetBlock?.prompt ?? "",
      modelAlias: modelAlias ?? targetBlock?.modelAlias ?? "",
      error,
      meta: {
        stage: "regenerate",
      },
    });

    response.status(error?.status || 500).json({
      error:
        error instanceof Error
          ? error.message
          : "重生成时出错了，请检查模型配置或网络。",
    });
  }
});

app.post("/api/chat", async (request, response) => {
  const { messages, provider = "openai", model } = request.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    response.status(400).json({ error: "messages 不能为空。" });
    return;
  }

  const safeMessages = messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.text ?? message.content ?? "",
    }));

  try {
    const result = await callProviderModel({
      provider,
      model,
      messages: [
        {
          role: "system",
          content: DEFAULT_SYSTEM_PROMPT,
        },
        ...safeMessages,
      ],
    });

    response.json({
      reply: result.reply,
      id: result.responseId,
      providerType: result.providerType,
      model: result.model,
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error?.message || "调用模型接口时出错了，请检查 Key、模型名或网络。",
    });
  }
});

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

  app.use(express.static(distDir, {
    maxAge: "7d",
    etag: true,
    lastModified: true,
  }));

  app.get("*", (_request, response, next) => {
    response.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) {
        next(err);
      }
    });
  });
}

function validateEnvironment() {
  const errors = [];

  if (isProduction) {
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
    const indexPath = path.join(distDir, "index.html");

    try {
      if (!fs.existsSync(indexPath)) {
        errors.push(`前端构建产物不存在 (${indexPath})，请先执行 npm run build。`);
      }
    } catch (distError) {
      errors.push(`无法读取 dist 目录 (${distDir}): ${distError.message}`);
    }

    if (JWT_SECRET === "hi-web-talk-jwt-secret-change-in-production") {
      errors.push("JWT_SECRET 未更改，生产环境必须设置唯一密钥。");
    }
  }

  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 16) {
      errors.push("JWT_SECRET 长度应不少于 16 个字符。");
    }
  } else if (isProduction) {
    errors.push("JWT_SECRET 环境变量未设置。");
  }

  const configuredModels = [
    { name: "OPENAI_API_KEY", label: "OpenAI (GPT)" },
    { name: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  ];

  const availableKeys = configuredModels.filter(
    (item) => process.env[item.name]
  );

  if (availableKeys.length === 0) {
    const keyNames = configuredModels.map((item) => item.name).join("、");
    console.warn(`未检测到任何 API Key (${keyNames})，将使用数据库中存储的模型 Key。`);
  }

  if (errors.length > 0) {
    console.error("环境变量校验失败:");
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exitCode = 1;
    throw new Error("环境变量校验失败，服务启动取消。");
  }
}

await ensureDataLayout();

let httpServer = null;

app.use((error, _request, response, _next) => {
  console.error("Unhandled error:", error);
  response.status(500).json({
    error: isProduction
      ? "服务器内部错误，请稍后再试。"
      : error instanceof Error ? error.message : "服务器内部错误。",
  });
});

function startServer(listenPort, attempt = 0) {
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, () => {
      console.log(`Hi Web Talk server listening on http://localhost:${listenPort}`);
      httpServer = server;
      resolve(server);

      function shutdown(signal) {
        if (!httpServer) {
          return;
        }

        console.log(`收到 ${signal} 信号，正在优雅关闭...`);

        httpServer.close(() => {
          try {
            getDatabase().close();
          } catch {
            // ignore
          }

          console.log("服务已关闭。");
          process.exit(0);
        });

        setTimeout(() => {
          console.error("超时未关闭，强制退出。");
          process.exit(1);
        }, 10000).unref();
      }

      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    });

    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE" && attempt < maxPortAttempts) {
        const nextPort = listenPort + 1;
        console.warn(`Port ${listenPort} is in use, retrying on ${nextPort}...`);
        server.close(() => {
          startServer(nextPort, attempt + 1).then(resolve, reject);
        });
        return;
      }

      console.error(error);
      process.exitCode = 1;
      reject(error);
    });
  });
}

const modulePath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv.length >= 2 && path.resolve(process.argv[1]) === modulePath;

if (isDirectRun) {
  validateEnvironment();
  startServer(port);
}

export { app, startServer, validateEnvironment, ensureDataLayout };
