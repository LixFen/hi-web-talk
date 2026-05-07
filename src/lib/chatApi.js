import { getToken } from "./tokenStore.js";

async function requestJson(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    headers,
    ...options,
  });

  const responseText = await response.text();
  let data = null;
  let parseError = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      parseError = error;
    }
  }

  if (!response.ok) {
    if (data?.error) {
      throw new Error(data.error);
    }

    if (responseText) {
      throw new Error(responseText);
    }

    throw new Error("请求失败，请稍后再试。");
  }

  if (responseText && parseError) {
    throw new Error("接口返回了无效 JSON，可能包含未正确转义的特殊字符。");
  }

  return data;
}

function normalizeSseLineBreaks(value = "") {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function collectSseDataPayload(frame = "") {
  const dataLines = [];

  for (const rawLine of normalizeSseLineBreaks(frame).split("\n")) {
    if (!rawLine || rawLine.startsWith(":")) {
      continue;
    }

    if (!rawLine.startsWith("data:")) {
      continue;
    }

    dataLines.push(rawLine.slice(5).replace(/^ /, ""));
  }

  return dataLines.join("\n");
}

function parseSsePayload(payload) {
  try {
    return {
      ok: true,
      value: JSON.parse(payload),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

async function readResponseError(response) {
  const responseText = await response.text();

  if (!responseText) {
    return "请求失败，请稍后再试。";
  }

  try {
    const data = JSON.parse(responseText);
    return data?.error || responseText;
  } catch {
    return responseText;
  }
}

export function listModelProviderDefinitions() {
  return requestJson("/api/model-provider-definitions");
}

export function getAppSettings() {
  return requestJson("/api/app-settings");
}

export function updateAppSettings(payload) {
  return requestJson("/api/app-settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listModels() {
  return requestJson("/api/models");
}

export function createModelConfig(payload) {
  return requestJson("/api/models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateModelConfig(alias, payload) {
  return requestJson(`/api/models/${encodeURIComponent(alias)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteModelConfig(alias) {
  return requestJson(`/api/models/${encodeURIComponent(alias)}`, {
    method: "DELETE",
  });
}

export function listAdaptationDefinitions() {
  return requestJson("/api/adaptation-definitions");
}

export function listSessions() {
  return requestJson("/api/sessions");
}

export function createSession() {
  return requestJson("/api/sessions", {
    method: "POST",
  });
}

export function getSession(sessionHash) {
  return requestJson(`/api/sessions/${sessionHash}`);
}

export function deleteSession(sessionHash) {
  return requestJson(`/api/sessions/${sessionHash}`, {
    method: "DELETE",
  });
}

export function updateSessionTitle(sessionHash, title) {
  return requestJson(`/api/sessions/${sessionHash}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function regenerateSessionTitle(sessionHash, { mode = "default", useChain = true } = {}) {
  return requestJson(`/api/sessions/${sessionHash}/regenerate-title`, {
    method: "POST",
    body: JSON.stringify({ mode, useChain }),
  });
}

export function updateSessionViewState(sessionHash, mode) {
  return requestJson(`/api/sessions/${sessionHash}/view-state`, {
    method: "PATCH",
    body: JSON.stringify({ mode }),
  });
}

export function setFocusedBlock(sessionHash, focusedBlockSHA1) {
  return requestJson(`/api/sessions/${sessionHash}/focused-block`, {
    method: "PATCH",
    body: JSON.stringify({ focusedBlockSHA1 }),
  });
}

export function sendReply({ sessionHash, prompt, modelAlias }) {
  return requestJson("/api/blocks/reply", {
    method: "POST",
    body: JSON.stringify({
      sessionHash,
      prompt,
      modelAlias,
    }),
  });
}

export async function sendReplyStream({ sessionHash, prompt, modelAlias, signal, onEvent }) {
  const token = getToken();
  const response = await fetch("/api/blocks/reply/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      sessionHash,
      prompt,
      modelAlias,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  if (!response.body) {
    throw new Error("当前环境不支持流式读取响应。");
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/event-stream")) {
    throw new Error(await readResponseError(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let isDone = false;
  let pendingPayload = "";

  while (!isDone) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += normalizeSseLineBreaks(decoder.decode(value, { stream: true }));
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const payload = collectSseDataPayload(frame);

      if (!payload) {
        continue;
      }

      const combinedPayload = pendingPayload ? `${pendingPayload}\n${payload}` : payload;

      if (combinedPayload === "[DONE]") {
        isDone = true;
        pendingPayload = "";
        break;
      }

      const parsedPayload = parseSsePayload(combinedPayload);

      if (!parsedPayload.ok) {
        pendingPayload = combinedPayload;
        continue;
      }

      pendingPayload = "";
      await onEvent?.(parsedPayload.value);
    }
  }

  buffer += normalizeSseLineBreaks(decoder.decode());
  const tailPayload = collectSseDataPayload(buffer);
  const finalPayload = pendingPayload
    ? `${pendingPayload}${tailPayload ? `\n${tailPayload}` : ""}`
    : tailPayload;

  if (!isDone && finalPayload) {
    if (finalPayload === "[DONE]") {
      return;
    }

    const parsedPayload = parseSsePayload(finalPayload);

    if (!parsedPayload.ok) {
      throw new Error("流式消息格式无效，可能包含未正确转义的特殊字符。");
    }

    await onEvent?.(parsedPayload.value);
  }

  if (!isDone) {
    throw new Error("流已结束，但服务端没有发送 [DONE] 结束标记。");
  }
}

export function regenerateBlock({ sessionHash, blockSHA1, modelAlias }) {
  return requestJson(`/api/blocks/${blockSHA1}/regenerate`, {
    method: "POST",
    body: JSON.stringify({
      sessionHash,
      modelAlias,
    }),
  });
}

export function uploadAttachment({ sessionHash, fileName, mimeType, base64Data }) {
  return requestJson("/api/attachments", {
    method: "POST",
    body: JSON.stringify({
      sessionHash,
      fileName,
      mimeType,
      base64Data,
    }),
  });
}

export function getAttachmentUrl(attachmentId) {
  return `/api/attachments/${attachmentId}`;
}

export function branchFromBlock({ sessionHash, blockSHA1 }) {
  return requestJson(`/api/blocks/${blockSHA1}/branch`, {
    method: "POST",
    body: JSON.stringify({ sessionHash }),
  });
}

export function setActiveBlock(sessionHash, blockSHA1) {
  return requestJson(`/api/sessions/${sessionHash}/active-block`, {
    method: "POST",
    body: JSON.stringify({ blockSHA1 }),
  });
}

export function deleteBlockTree({ sessionHash, blockSHA1 }) {
  return requestJson(`/api/sessions/${sessionHash}/blocks/${blockSHA1}/tree`, {
    method: "DELETE",
  });
}

export function updateBlockAdaptation({
  sessionHash,
  blockSHA1,
  key,
  enabled,
  status,
  source = "user",
  config = {},
  payload = {},
  meta = {},
}) {
  return requestJson(`/api/sessions/${sessionHash}/blocks/${blockSHA1}/adaptations/${key}`, {
    method: "PUT",
    body: JSON.stringify({
      enabled,
      status,
      source,
      config,
      payload,
      meta,
    }),
  });
}

export function runBlockAdaptationCommand({ sessionHash, blockSHA1, key, modelAlias }) {
  return requestJson(
    `/api/sessions/${sessionHash}/blocks/${blockSHA1}/adaptations/${key}/run`,
    {
      method: "POST",
      body: JSON.stringify({ modelAlias }),
    },
  );
}

export function loginUser(username, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function registerUser(username, password) {
  return requestJson("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logoutUser() {
  return requestJson("/api/auth/logout", {
    method: "POST",
  });
}

export async function subscribeToSessionStream(sessionHash, { signal, onEvent } = {}) {
  const token = getToken();
  const response = await fetch(`/api/sessions/${sessionHash}/stream`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });

  if (response.status === 204) {
    return { active: false };
  }

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  if (!response.body) {
    throw new Error("当前环境不支持流式读取响应。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let isDone = false;
  let pendingPayload = "";

  while (!isDone) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += normalizeSseLineBreaks(decoder.decode(value, { stream: true }));
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const payload = collectSseDataPayload(frame);

      if (!payload) {
        continue;
      }

      const combinedPayload = pendingPayload ? `${pendingPayload}\n${payload}` : payload;

      if (combinedPayload === "[DONE]") {
        isDone = true;
        pendingPayload = "";
        break;
      }

      const parsedPayload = parseSsePayload(combinedPayload);

      if (!parsedPayload.ok) {
        pendingPayload = combinedPayload;
        continue;
      }

      pendingPayload = "";
      await onEvent?.(parsedPayload.value);
    }
  }

  buffer += normalizeSseLineBreaks(decoder.decode());
  const tailPayload = collectSseDataPayload(buffer);
  const finalPayload = pendingPayload
    ? `${pendingPayload}${tailPayload ? `\n${tailPayload}` : ""}`
    : tailPayload;

  if (!isDone && finalPayload) {
    if (finalPayload === "[DONE]") {
      return { active: true };
    }

    const parsedPayload = parseSsePayload(finalPayload);

    if (!parsedPayload.ok) {
      throw new Error("流式消息格式无效，可能包含未正确转义的特殊字符。");
    }

    await onEvent?.(parsedPayload.value);
  }

  return { active: true };
}

export function getCurrentUser() {
  return requestJson("/api/auth/me");
}
