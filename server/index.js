import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { DEFAULT_SYSTEM_PROMPT, JWT_SECRET, JWT_EXPIRES_IN } from "./constants.js";
import { getDatabase } from "./lib/database.js";
import { authenticateToken, requireSessionOwnership } from "./middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "./middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  appSettingsSchema,
  modelCreateSchema,
  modelUpdateSchema,
  attachmentUploadSchema,
  blockReplySchema,
  blockReplyStreamSchema,
  blockBranchSchema,
  blockRegenerateSchema,
  sessionUpdateSchema,
  sessionRegenerateTitleSchema,
  sessionViewStateSchema,
  sessionFocusedBlockSchema,
  sessionActiveBlockSchema,
  blockAdaptationUpsertSchema,
  blockAdaptationRunSchema,
  summaryUpdateSchema,
  summaryGenerateSchema,
  pathSessionHashSchema,
  pathBlockSHA1Schema,
  pathModelAliasSchema,
  pathAdaptationKeySchema,
  pathAttachmentIdSchema,
  paginationQuerySchema,
} from "./lib/validation.js";
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
import { buildContextForActiveBlock, downgradeMessagesForModel } from "./services/contextBuilderService.js";
import {
  appendErrorLog,
  listErrorLogs,
} from "./services/errorLogService.js";
import { callProviderModel, streamProviderModel, invalidateModelAdapterCache } from "./services/llmProviderService.js";
import { streamSessionManager } from "./services/streamSessionManager.js";
import { saveAttachment, readAttachment, updateAttachmentBlockSHA1 } from "./services/attachmentService.js";
import { resolveAttachmentMessages } from "./services/providerAdapters/attachmentResolver.js";
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
  generateTitleForSession,
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
        styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
        fontSrc: ["'self'", "fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);

app.use(cookieParser());

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

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "登录请求过于频繁，请稍后再试。" },
});

app.use("/api", apiLimiter);
app.use(express.json({ limit: "10mb" }));

app.post("/api/auth/register", authLimiter, validateBody(registerSchema), async (request, response) => {
  try {
    const { username, password } = request.body;
    const result = await registerUser(username, password);
    response.cookie("auth_token", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    response.status(201).json(result);
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "注册失败。",
    });
  }
});

app.post("/api/auth/login", authLimiter, validateBody(loginSchema), async (request, response) => {
  try {
    const { username, password } = request.body;
    const result = await loginUser(username, password);
    response.cookie("auth_token", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
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

app.post("/api/auth/logout", (request, response) => {
  response.clearCookie("auth_token", { path: "/" });
  response.json({ ok: true });
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
    supportsSystemRole: body.supportsSystemRole,
    supportsMultimodal: body.supportsMultimodal,
    supportsThinking: body.supportsThinking,
    thinkingDisable: body.thinkingDisable,
    systemPromptRole: body.systemPromptRole,
    requestOptions: body.requestOptions,
    isPreset: body.isPreset,
    shared: body.shared,
    meta: body.meta,
  };
}

function isValidPrompt(prompt) {
  if (typeof prompt === "string") {
    return prompt.trim().length > 0;
  }

  if (Array.isArray(prompt)) {
    return prompt.length > 0 && prompt.some((block) => {
      if (block.type === "text") {
        return (block.text ?? "").trim().length > 0;
      }
      return block.type === "image_url" || block.type === "image_attachment";
    });
  }

  return false;
}

function normalizePrompt(prompt) {
  if (typeof prompt === "string") {
    return prompt.trim();
  }

  if (Array.isArray(prompt)) {
    return prompt.map((block) => {
      if (typeof block === "string") {
        return { type: "text", text: block.trim() };
      }
      return block;
    }).filter((block) => block != null);
  }

  return String(prompt ?? "").trim();
}

function extractAttachmentIds(prompt) {
  if (!Array.isArray(prompt)) {
    return [];
  }

  return prompt
    .filter((block) => block && block.type === "image_attachment" && block.attachmentId)
    .map((block) => block.attachmentId);
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
    //console.log(`[stream] ${timestamp} ${stage}`);
    return;
  }

  //console.log(`[stream] ${timestamp} ${stage}`, payload);
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

app.patch("/api/app-settings", authenticateToken, validateBody(appSettingsSchema), async (request, response) => {
  try {
    const settings = await updateAppSettings(request.body, request.user.id);
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

app.post("/api/models", authenticateToken, validateBody(modelCreateSchema), async (request, response) => {
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

app.put("/api/models/:alias", authenticateToken, validateParams(pathModelAliasSchema), validateBody(modelUpdateSchema), async (request, response) => {
  try {
    const model = await updateModel(request.params.alias, parseModelPayload(request.body), request.user.id, request.user.role);
    invalidateModelAdapterCache();
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

app.delete("/api/models/:alias", authenticateToken, validateParams(pathModelAliasSchema), async (request, response) => {
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

app.post("/api/attachments", authenticateToken, validateBody(attachmentUploadSchema), async (request, response) => {
  try {
    const { sessionHash, fileName, mimeType, base64Data } = request.body;

    const session = readSessionRecord(sessionHash);

    if (!session) {
      response.status(404).json({ error: "会话不存在。" });
      return;
    }

    if (session.userId != null && session.userId !== request.user.id) {
      response.status(403).json({ error: "无权访问该会话。" });
      return;
    }

    const buffer = Buffer.from(base64Data, "base64");
    const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
    const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      response.status(413).json({ error: "附件大小超过 5MB 限制。" });
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      response.status(415).json({ error: "不支持的文件类型，仅允许 jpeg、png、webp、gif。" });
      return;
    }

    const attachment = await saveAttachment(sessionHash, null, fileName || "attachment", mimeType, buffer);

    response.status(201).json({
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "上传附件失败。",
    });
  }
});

app.get("/api/attachments/:attachmentId", authenticateToken, validateParams(pathAttachmentIdSchema), async (request, response) => {
  try {
    const attachment = await readAttachment(request.params.attachmentId);

    if (!attachment) {
      response.status(404).json({ error: "附件不存在。" });
      return;
    }

    const session = readSessionRecord(attachment.sessionHash);

    if (session && session.userId != null && session.userId !== request.user.id) {
      response.status(403).json({ error: "无权访问该附件。" });
      return;
    }

    response.setHeader("Content-Type", attachment.mimeType);
    response.setHeader("Content-Length", attachment.buffer.length);
    response.send(attachment.buffer);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "读取附件失败。",
    });
  }
});

app.get("/api/adaptation-definitions", (_request, response) => {
  response.json({ definitions: listAdaptationDefinitions() });
});

app.get("/api/sessions", authenticateToken, validateQuery(paginationQuerySchema), async (request, response) => {
  const { page, pageSize } = request.query;
  const offset = (page - 1) * pageSize;

  const { sessions, total } = await listSessions(request.user.id, { limit: pageSize, offset });
  response.json({
    sessions,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

app.post("/api/sessions", authenticateToken, async (request, response) => {
  const detail = await createSession(request.user.id);
  response.status(201).json(detail);
});

app.delete("/api/sessions/:sessionHash", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateQuery(paginationQuerySchema), async (request, response) => {
  try {
    const result = await deleteSession(request.params.sessionHash);
    const { page, pageSize } = request.query;
    const { total } = await listSessions(request.user.id, { limit: pageSize, offset: 0 });
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const nextPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
    const offset = (nextPage - 1) * pageSize;
    const { sessions } = await listSessions(request.user.id, { limit: pageSize, offset });
    response.json({
      ...result,
      sessions,
      pagination: {
        page: nextPage,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "删除会话失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), async (request, response) => {
  try {
    const detail = await getSessionDetail(request.params.sessionHash);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "读取会话失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(sessionUpdateSchema), async (request, response) => {
  try {
    const detail = await updateSessionTitle(request.params.sessionHash, request.body.title);
    response.json(detail);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新会话名称失败。",
    });
  }
});

app.post("/api/sessions/:sessionHash/regenerate-title", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(sessionRegenerateTitleSchema), async (request, response) => {
  try {
    const mode = request.body.mode === "important" ? "important" : "default";
    const useChain = request.body.useChain !== false;
    const detail = await generateTitleForSession(request.params.sessionHash, { mode, useChain, role: request.user.role });
    response.json(detail);
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "生成标题失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash/view-state", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(sessionViewStateSchema), async (request, response) => {
  try {
    const partialViewState = {};

    if (Object.prototype.hasOwnProperty.call(request.body, "mode")) {
      partialViewState.mode = request.body.mode;
    }

    if (Object.prototype.hasOwnProperty.call(request.body, "focusedBlockSHA1")) {
      partialViewState.focusedBlockSHA1 = request.body.focusedBlockSHA1;
    }

    const detail = await updateSessionViewState(
      request.params.sessionHash,
      partialViewState,
      partialViewState.mode,
    );
    response.json(detail);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新视图状态失败。",
    });
  }
});

app.patch("/api/sessions/:sessionHash/focused-block", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(sessionFocusedBlockSchema), async (request, response) => {
  try {
    const result = await updateSessionFocusedBlock(
      request.params.sessionHash,
      request.body.focusedBlockSHA1,
    );
    response.json(result);
  } catch (error) {
    response.status(error?.status || 404).json({
      error: error instanceof Error ? error.message : "更新焦点失败。",
    });
  }
});

app.post("/api/sessions/:sessionHash/active-block", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(sessionActiveBlockSchema), async (request, response) => {
  const { blockSHA1, focusedBlockSHA1 } = request.body;

  try {
    const detail = await setActiveBlock(request.params.sessionHash, blockSHA1, focusedBlockSHA1);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "切换 active block 失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/adaptations", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateQuery(paginationQuerySchema), async (request, response) => {
  try {
    const { page, pageSize } = request.query;
    const offset = (page - 1) * pageSize;
    const { adaptations, total } = await listSessionAdaptations(request.params.sessionHash, { limit: pageSize, offset });
    response.json({
      adaptations,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "读取适配项失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), async (request, response) => {
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

app.put("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations/:key", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(blockAdaptationUpsertSchema), async (request, response) => {
  try {
    const adaptation = await upsertBlockAdaptation(
      request.params.sessionHash,
      request.params.blockSHA1,
      request.params.key,
      {
        enabled: request.body.enabled,
        status: request.body.status,
        source: request.body.source ?? "user",
        config: request.body.config ?? {},
        payload: request.body.payload ?? {},
        meta: request.body.meta ?? {},
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

app.post("/api/sessions/:sessionHash/blocks/:blockSHA1/adaptations/:key/run", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(blockAdaptationRunSchema), async (request, response) => {
  const { modelAlias } = request.body;

  try {
    if (request.params.key !== "summary.generate") {
      response.status(400).json({ error: "这个适配命令暂时还不支持执行。" });
      return;
    }

    const summary = await generateSummaryForBlock(
      request.params.sessionHash,
      request.params.blockSHA1,
      modelAlias,
      { role: request.user.role },
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

app.get("/api/sessions/:sessionHash/summaries", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateQuery(paginationQuerySchema), async (request, response) => {
  try {
    const { page, pageSize } = request.query;
    const offset = (page - 1) * pageSize;
    const { summaries, total } = await listSummaries(request.params.sessionHash, { limit: pageSize, offset });
    response.json({
      summaries,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "读取摘要失败。",
    });
  }
});

app.get("/api/sessions/:sessionHash/summaries/:blockSHA1", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), async (request, response) => {
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

app.patch("/api/sessions/:sessionHash/summaries/:blockSHA1", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(summaryUpdateSchema), async (request, response) => {
  const { status, summary, errorMessage, modelAlias } = request.body;
  const nextSummary = await updateSummaryStatus(request.params.sessionHash, request.params.blockSHA1, {
    status,
    summary,
    errorMessage,
    modelAlias,
    source: "user",
  });

  response.json({ summary: nextSummary });
});

app.post("/api/sessions/:sessionHash/summaries/:blockSHA1/generate", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateBody(summaryGenerateSchema), async (request, response) => {
  const { modelAlias } = request.body;

  try {
    const summary = await generateSummaryForBlock(
      request.params.sessionHash,
      request.params.blockSHA1,
      modelAlias,
      { role: request.user.role },
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

app.get("/api/sessions/:sessionHash/errors", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), validateQuery(paginationQuerySchema), async (request, response) => {
  try {
    const { page, pageSize } = request.query;
    const offset = (page - 1) * pageSize;

    const { errors, total } = await listErrorLogs(request.params.sessionHash, { limit: pageSize, offset });
    response.json({
      errors,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    response.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "读取错误日志失败。",
    });
  }
});

app.post("/api/blocks/:blockSHA1/branch", authenticateToken, validateParams(pathBlockSHA1Schema), validateBody(blockBranchSchema), async (request, response) => {
  const { sessionHash } = request.body;

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
    const detail = await setActiveBlock(sessionHash, request.params.blockSHA1, request.params.blockSHA1);
    response.json(detail);
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "创建分支失败。",
    });
  }
});

app.post("/api/blocks/reply", authenticateToken, validateBody(blockReplySchema), async (request, response) => {
  const { sessionHash, prompt, modelAlias } = request.body;

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  const normalizedPrompt = normalizePrompt(prompt);

  try {
    const selectedModel = await getModelByAlias(modelAlias, request.user.id, request.user.role);
    if (!selectedModel || selectedModel.enabled === false) {
      response.status(400).json({ error: "未找到可用的模型配置。" });
      return;
    }

    const context = await buildContextForActiveBlock(sessionHash, session.activeBlockSHA1);
    let providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: normalizedPrompt },
    ];

    if (selectedModel.supportsMultimodal !== false) {
      providerMessages = await resolveAttachmentMessages(providerMessages);
    }

    providerMessages = downgradeMessagesForModel(providerMessages, selectedModel.supportsMultimodal);

    const result = await callProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
    });

    const block = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: normalizedPrompt,
      response: result.reply,
      reasoning: result.reasoning ?? "",
      parentBlockSHA1: session.activeBlockSHA1,
      contextLength: context.contextLength,
      tokenUsage: result.usage,
      meta: {
        providerType: result.providerType,
        model: result.model,
        responseId: result.responseId,
      },
    });

    const attachmentIds = extractAttachmentIds(normalizedPrompt);

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(
        typeof normalizedPrompt === "string" ? normalizedPrompt : normalizedPrompt.map((b) => b.text ?? "").join(" "),
        session.title,
      ),
      updatedAt: new Date().toISOString(),
      activeBlockSHA1: block.sha1,
    });

    const attachmentPromise = attachmentIds.length > 0
      ? Promise.all(attachmentIds.map((id) => updateAttachmentBlockSHA1(sessionHash, id, block.sha1)))
      : Promise.resolve();
    const detailPromise = getSessionDetail(sessionHash, { summaries: context.summaries, adaptationMap: context.adaptationMap });
    const [detail] = await Promise.all([detailPromise, attachmentPromise]);
    response.status(201).json(detail);
  } catch (error) {
    await tryAppendErrorLog({
      sessionHash,
      operation: "reply",
      parentBlockSHA1: null,
      blockSHA1: null,
      prompt: typeof normalizedPrompt === "string" ? normalizedPrompt : JSON.stringify(normalizedPrompt),
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

app.post("/api/blocks/reply/stream", authenticateToken, validateBody(blockReplyStreamSchema), async (request, response) => {
  const { sessionHash, prompt, modelAlias } = request.body;

  const session = readSessionRecord(sessionHash);

  if (!session) {
    response.status(404).json({ error: "会话不存在。" });
    return;
  }

  if (session.userId != null && session.userId !== request.user.id) {
    response.status(403).json({ error: "无权访问该会话。" });
    return;
  }

  logStream("request-start", { sessionHash, modelAlias, promptLength: (typeof prompt === "string" ? prompt : "").length });
  const selectedModel = await getModelByAlias(modelAlias, request.user.id, request.user.role);
  if (!selectedModel || selectedModel.enabled === false) {
    response.status(400).json({ error: "未找到可用的模型配置。" });
    return;
  }

  if (selectedModel.supportsStreaming === false) {
    response.status(400).json({ error: "该模型未启用流式传输，请改用非流式回复接口。" });
    return;
  }

  const normalizedPrompt = normalizePrompt(prompt);
  const promptPreview = typeof normalizedPrompt === "string"
    ? normalizedPrompt
    : normalizedPrompt.map((b) => b.text ?? "").join(" ");

  prepareSSE(response);
  response.write(":ok\n\n");
  logStream("sse-prepared", { sessionHash, activeBlockSHA1: session.activeBlockSHA1 });

  let clientConnected = true;
  let responseFinished = false;
  const handleAbort = () => {
    clientConnected = false;
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

  const streamSession = streamSessionManager.create(sessionHash);
  const unsubscribe = streamSession.subscribe((event) => {
    if (clientConnected && !response.writableEnded && !response.destroyed) {
      try {
        writeRawSSE(response, JSON.stringify(event));
      } catch {
        // ignore write errors on closed connections
      }
    }
  });

  try {

    const context = await buildContextForActiveBlock(sessionHash, session.activeBlockSHA1);
    logStream("context-built", {
      sessionHash,
      contextLength: context.contextLength,
      messageCount: context.messages.length,
    });
    let providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: normalizedPrompt },
    ];

    if (selectedModel.supportsMultimodal !== false) {
      providerMessages = await resolveAttachmentMessages(providerMessages);
    }

    providerMessages = downgradeMessagesForModel(providerMessages, selectedModel.supportsMultimodal);

    const startEvent = {
      type: "start",
      sessionHash,
      modelAlias: selectedModel.alias,
    };
    streamSession.pushEvent(startEvent);
    logStream("start-sent", { sessionHash, modelAlias: selectedModel.alias });

    const result = await streamProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
      onChunk: async ({ delta = "", reasoningDelta = "" } = {}) => {
        if (delta || reasoningDelta) {
          const payload = { type: "delta" };
          if (delta) payload.delta = delta;
          if (reasoningDelta) payload.reasoningDelta = reasoningDelta;
          streamSession.pushEvent(payload);
          logStream("delta-sent", { length: delta.length, reasoningLength: reasoningDelta.length, preview: delta.slice(0, 60) });
        }
      },
    });

    logStream("provider-finished", {
      replyLength: result.reply.length,
      responseId: result.responseId,
      usage: result.usage,
    });

    const block = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: normalizedPrompt,
      response: result.reply,
      reasoning: result.reasoning ?? "",
      parentBlockSHA1: session.activeBlockSHA1,
      contextLength: context.contextLength,
      tokenUsage: result.usage,
      meta: {
        providerType: result.providerType,
        model: result.model,
        responseId: result.responseId,
      },
    });

    const streamAttachmentIds = extractAttachmentIds(normalizedPrompt);

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(promptPreview, session.title),
      updatedAt: new Date().toISOString(),
      activeBlockSHA1: block.sha1,
    });
    logStream("session-updated", { sessionHash, blockSHA1: block.sha1 });

    const attachmentPromise = streamAttachmentIds.length > 0
      ? Promise.all(streamAttachmentIds.map((id) => updateAttachmentBlockSHA1(sessionHash, id, block.sha1)))
      : Promise.resolve();
    const detailPromise = getSessionDetail(sessionHash, { summaries: context.summaries, adaptationMap: context.adaptationMap });
    const [detail] = await Promise.all([detailPromise, attachmentPromise]);
    logStream("detail-ready", {
      sessionHash,
      messageCount: detail.messages.length,
      activeBlockSHA1: detail.graph?.activeBlockSHA1,
    });

    const completeEvent = { type: "complete", detail };
    streamSession.pushEvent(completeEvent);
    logStream("complete-sent", { sessionHash });

    streamSession.complete(detail);
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
      prompt: typeof normalizedPrompt === "string" ? normalizedPrompt : JSON.stringify(normalizedPrompt),
      modelAlias: modelAlias ?? "",
      error,
      meta: {
        stage: "reply-stream",
      },
    });

    streamSession.fail(error);

    if (!response.headersSent) {
      response.status(error?.status || 500).json({
        error:
          error instanceof Error
            ? error.message
            : "调用模型接口时出错了，请检查 Key、模型名或网络。",
      });
      return;
    }

    writeDoneSSE(response);
    response.end();
  } finally {
    request.off("close", handleAbort);
    response.off("finish", handleFinish);
    unsubscribe();
  }
});

app.get("/api/sessions/:sessionHash/stream", authenticateToken, validateParams(pathSessionHashSchema), requireSessionOwnership(), async (request, response) => {
  const { sessionHash } = request.params;
  const streamSession = streamSessionManager.get(sessionHash);

  if (!streamSession) {
    response.status(204).end();
    return;
  }

  prepareSSE(response);
  response.write(":ok\n\n");

  let clientConnected = true;
  let unsubscribeStream = null;

  const handleAbort = () => {
    clientConnected = false;
    if (unsubscribeStream) {
      unsubscribeStream();
    }
  };
  request.on("close", handleAbort);

  const pastEvents = [...streamSession.events];
  for (const event of pastEvents) {
    if (!clientConnected || response.writableEnded || response.destroyed) {
      break;
    }
    writeRawSSE(response, JSON.stringify(event));
  }

  if (!clientConnected || response.writableEnded || response.destroyed) {
    response.end();
    return;
  }

  if (streamSession.completed) {
    writeDoneSSE(response);
    response.end();
    return;
  }

  unsubscribeStream = streamSession.subscribe((event) => {
    if (!clientConnected || response.writableEnded || response.destroyed) {
      return;
    }
    try {
      writeRawSSE(response, JSON.stringify(event));
      if (event.type === "complete") {
        writeDoneSSE(response);
        response.end();
      } else if (event.type === "error") {
        writeDoneSSE(response);
        response.end();
      }
    } catch {
      // ignore write errors
    }
  });
});

app.post("/api/blocks/:blockSHA1/regenerate", authenticateToken, validateParams(pathBlockSHA1Schema), validateBody(blockRegenerateSchema), async (request, response) => {
  const { sessionHash, modelAlias } = request.body;

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
    let providerMessages = [
      ...(context.messages.length > 0
        ? context.messages
        : [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]),
      { role: "user", content: targetBlock.prompt },
    ];

    if (selectedModel.supportsMultimodal !== false) {
      providerMessages = await resolveAttachmentMessages(providerMessages);
    }

    providerMessages = downgradeMessagesForModel(providerMessages, selectedModel.supportsMultimodal);

    const result = await callProviderModel({
      modelConfig: selectedModel,
      messages: providerMessages,
    });

    const regeneratedBlock = await createDialogueBlock(sessionHash, {
      modelAlias: selectedModel.alias,
      prompt: targetBlock.prompt,
      response: result.reply,
      reasoning: result.reasoning ?? "",
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

    const regenerateAttachmentIds = extractAttachmentIds(targetBlock.prompt);
    if (regenerateAttachmentIds.length > 0) {
      await Promise.all(regenerateAttachmentIds.map((id) => updateAttachmentBlockSHA1(sessionHash, id, regeneratedBlock.sha1)));
    }

    const promptPreview = typeof targetBlock.prompt === "string"
      ? targetBlock.prompt
      : targetBlock.prompt.map((b) => b.text ?? "").join(" ");

    await updateSession(sessionHash, {
      title: getSuggestedSessionTitle(promptPreview, session.title),
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
      prompt: typeof targetBlock?.prompt === "string" ? targetBlock.prompt : JSON.stringify(targetBlock?.prompt ?? ""),
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

const isProduction = process.env.NODE_ENV === "production";

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
streamSessionManager.startCleanupTimer();

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
