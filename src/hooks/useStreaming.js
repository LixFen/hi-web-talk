import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelReplyStream,
  createSession,
  sendReply,
  sendReplyStream,
  subscribeToSessionStream,
  uploadAttachment,
} from "../lib/chatApi";

function createOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default function useStreaming({
  getSessionHash,
  selectedModel,
  searchMode,
  searchEngine,
  systemPrompt,
  onApplyDetail,
  onSetLoading,
  onSetError,
}) {
  const navigate = useNavigate();
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [streamingToolState, setStreamingToolState] = useState(null);
  const [streamingTikzSvg, setStreamingTikzSvg] = useState(null);
  const currentOperationRef = useRef(null);
  const streamAbortControllerRef = useRef(null);
  const operationIdsBySessionRef = useRef(new Map());

  const isCurrentOperation = useCallback((operation) => currentOperationRef.current === operation, []);

  const clearSessionOperation = useCallback((operation) => {
    if (!operation.sessionHash) return;

    const currentOperationId = operationIdsBySessionRef.current.get(operation.sessionHash);
    if (currentOperationId === operation.serverOperationId || currentOperationId === operation.id) {
      operationIdsBySessionRef.current.delete(operation.sessionHash);
    }
  }, []);

  const clearStreamingState = useCallback(() => {
    setPendingPrompt("");
    setStreamingReply("");
    setStreamingReasoning("");
    setStreamingToolState(null);
    setStreamingTikzSvg(null);
  }, []);

  const finishOperation = useCallback(
    (operation) => {
      if (!isCurrentOperation(operation)) return;

      if (operation.flushRaf) {
        cancelAnimationFrame(operation.flushRaf);
      }
      currentOperationRef.current = null;
      if (streamAbortControllerRef.current === operation.controller) {
        streamAbortControllerRef.current = null;
      }
      clearStreamingState();
      onSetLoading(false);
    },
    [clearStreamingState, isCurrentOperation, onSetLoading],
  );

  const startOperation = useCallback(
    (type, sessionHash = "", serverOperationId = null) => {
      const previous = currentOperationRef.current;
      if (previous) {
        if (previous.flushRaf) {
          cancelAnimationFrame(previous.flushRaf);
        }
        previous.controller.abort();
      }

      const operationId = createOperationId();
      const operation = {
        id: operationId,
        type,
        sessionHash,
        controller: new AbortController(),
        flushRaf: 0,
        reply: "",
        reasoning: "",
        serverOperationId: type === "send" ? operationId : serverOperationId,
      };
      currentOperationRef.current = operation;
      if (type === "send") {
        streamAbortControllerRef.current = operation.controller;
      }
      onSetLoading(true);
      clearStreamingState();
      return operation;
    },
    [clearStreamingState, onSetLoading],
  );

  const scheduleFlush = useCallback(
    (operation) => {
      if (!isCurrentOperation(operation) || operation.flushRaf) return;

      operation.flushRaf = requestAnimationFrame(() => {
        operation.flushRaf = 0;
        if (!isCurrentOperation(operation)) return;
        setStreamingReply(operation.reply);
        setStreamingReasoning(operation.reasoning);
      });
    },
    [isCurrentOperation],
  );

  const resetReplayState = useCallback(
    (operation) => {
      if (!isCurrentOperation(operation)) return;
      if (operation.flushRaf) {
        cancelAnimationFrame(operation.flushRaf);
        operation.flushRaf = 0;
      }
      operation.reply = "";
      operation.reasoning = "";
      setStreamingReply("");
      setStreamingReasoning("");
      setStreamingToolState(null);
      setStreamingTikzSvg(null);
    },
    [isCurrentOperation],
  );

  const applyStreamEvent = useCallback(
    (operation, event, { onComplete } = {}) => {
      if (!isCurrentOperation(operation)) return;

      if (event?.operationId) {
        if (operation.serverOperationId && operation.serverOperationId !== event.operationId) {
          return;
        }
        operation.serverOperationId = event.operationId;
        if (operation.sessionHash) {
          operationIdsBySessionRef.current.set(operation.sessionHash, event.operationId);
        }
      }

      if (event?.type === "tool_start") {
        if (event.toolName === "web_search") {
          setStreamingToolState({ type: "searching", toolName: event.toolName, query: event.arguments?.query });
        }
        if (event.toolName === "draw_tikz") {
          setStreamingToolState({ type: "drawing", toolName: event.toolName });
          setStreamingTikzSvg(null);
        }
        return;
      }

      if (event?.type === "tool_result") {
        if (event.toolName === "web_search") {
          setStreamingToolState({ type: "searched", toolName: event.toolName, engine: event.engine, sources: event.sources });
        }
        if (event.toolName === "draw_tikz") {
          if (event.compiled && event.svg) {
            setStreamingTikzSvg(event.svg);
          }
          setStreamingToolState({
            type: event.compiled ? "drawn" : "failed",
            toolName: event.toolName,
            error: event.error,
          });
        }
        return;
      }

      if (event?.type === "reasoning_round") {
        if (event.reasoningDelta) {
          operation.reasoning += `\n\n---\n\n${event.reasoningDelta}`;
        } else if (operation.reasoning) {
          operation.reasoning += "\n\n---\n\n";
        }
        scheduleFlush(operation);
        return;
      }

      if (event?.type === "delta") {
        operation.reply += event.delta || "";
        operation.reasoning += event.reasoningDelta || event.reasoning_delta || "";
        scheduleFlush(operation);
        return;
      }

      if (event?.type === "complete") {
        clearSessionOperation(operation);
        onComplete?.(event.detail);
        return;
      }

      if (event?.type === "cancelled") {
        clearSessionOperation(operation);
        return;
      }

      if (event?.type === "error") {
        clearSessionOperation(operation);
        console.error("[useStreaming] stream error event", {
          event,
          operationId: operation.serverOperationId || operation.id,
        });
        throw new Error(event.error || "请求失败了，请稍后再试。");
      }
    },
    [clearSessionOperation, isCurrentOperation, scheduleFlush],
  );

  const subscribeToStream = useCallback(
    async (sessionHash) => {
      const current = currentOperationRef.current;
      if (current?.type === "send" && current.sessionHash === sessionHash) {
        return true;
      }
      const serverOperationId = operationIdsBySessionRef.current.get(sessionHash);
      const operation = startOperation(
        "subscribe",
        sessionHash,
        serverOperationId,
      );
      let completed = false;

      try {
        const result = await subscribeToSessionStream(sessionHash, {
          operationId: operation.serverOperationId || undefined,
          signal: operation.controller.signal,
          onEvent: (event) =>
            applyStreamEvent(operation, event, {
              onComplete: (detail) => {
                if (!isCurrentOperation(operation)) return;
                completed = true;
                onApplyDetail(detail);
              },
            }),
        });

        if (!result.active && !completed) {
          clearSessionOperation(operation);
        }
        return result.active || completed;
      } catch (err) {
        if (isCurrentOperation(operation) && err?.name !== "AbortError") {
          console.error("[useStreaming] stream reconnect failed", err);
          onSetError(err instanceof Error ? err.message : "流式重连失败。");
        }
        return false;
      } finally {
        finishOperation(operation);
      }
    },
    [applyStreamEvent, clearSessionOperation, finishOperation, isCurrentOperation, onApplyDetail, onSetError, startOperation],
  );

  const handleUploadAttachment = useCallback(
    async ({ fileName, mimeType, base64Data }) => {
      let sessionHash = getSessionHash();
      if (!sessionHash) {
        const createdDetail = await createSession(systemPrompt?.content || "");
        onApplyDetail(createdDetail);
        sessionHash = createdDetail.session.sessionHash;
        navigate(`/chat/${sessionHash}`);
      }
      return uploadAttachment({ sessionHash, fileName, mimeType, base64Data });
    },
    [getSessionHash, systemPrompt, onApplyDetail, navigate],
  );

  const handleSend = useCallback(
    async (rawContent) => {
      const isArray = Array.isArray(rawContent);
      const textPreview = isArray
        ? rawContent.map((block) => block.text ?? "").join(" ").trim()
        : rawContent.trim();
      const model = selectedModel;
      if ((!textPreview && !isArray) || !model) return false;

      const operation = startOperation("send", getSessionHash() || "");
      setPendingPrompt(rawContent);
      const supportsStreaming = model.supportsStreaming !== false;

      try {
        if (!operation.sessionHash) {
          const createdDetail = await createSession(systemPrompt?.content || "");
          if (!isCurrentOperation(operation)) return false;
          onApplyDetail(createdDetail);
          operation.sessionHash = createdDetail.session.sessionHash;
          navigate(`/chat/${operation.sessionHash}`);
        }

        const prompt = isArray ? rawContent : rawContent.trim();
        if (!supportsStreaming) {
          const detail = await sendReply({
            sessionHash: operation.sessionHash,
            prompt,
            modelAlias: model.alias,
            searchMode,
            searchEngine,
          });
          if (!isCurrentOperation(operation)) return false;
          onApplyDetail(detail, {
            revealLatestInChat: true,
            reason: "send-reply",
            behavior: "auto",
          });
          clearSessionOperation(operation);
          return true;
        }

        let streamedDetail = null;
        const onStreamEvent = (event) =>
          applyStreamEvent(operation, event, {
            onComplete: (detail) => {
              streamedDetail = detail;
            },
          });

        try {
          operationIdsBySessionRef.current.set(operation.sessionHash, operation.id);
          await sendReplyStream({
            sessionHash: operation.sessionHash,
            prompt,
            modelAlias: model.alias,
            searchMode,
            searchEngine,
            operationId: operation.id,
            signal: operation.controller.signal,
            onEvent: onStreamEvent,
          });
        } catch (streamError) {
          if (streamError?.name === "AbortError") throw streamError;

          resetReplayState(operation);
          try {
            await subscribeToSessionStream(operation.sessionHash, {
              operationId: operation.id,
              signal: operation.controller.signal,
              onEvent: onStreamEvent,
            });
          } catch {
            throw streamError;
          }
        }

        if (!streamedDetail) {
          throw new Error("流式请求未返回完成事件。");
        }
        if (!isCurrentOperation(operation)) return false;

        onApplyDetail(streamedDetail, { revealLatestInChat: false });
        return true;
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("[useStreaming] send failed", err);
        }
        if (isCurrentOperation(operation)) {
          onSetError(
            err?.name === "AbortError"
              ? "已停止生成。"
              : err instanceof Error
                ? err.message
                : "请求失败了，请稍后再试。",
          );
        }
        return false;
      } finally {
        finishOperation(operation);
      }
    },
    [applyStreamEvent, clearSessionOperation, finishOperation, getSessionHash, isCurrentOperation, navigate, onApplyDetail, onSetError, resetReplayState, searchEngine, searchMode, selectedModel, startOperation, systemPrompt],
  );

  const handleStopStreaming = useCallback(() => {
    const operation = currentOperationRef.current;
    if (!operation || operation.type !== "send") return;

    operation.controller.abort();
    if (operation.sessionHash) {
      cancelReplyStream({
        sessionHash: operation.sessionHash,
        operationId: operation.id,
      }).then(() => {
        clearSessionOperation(operation);
      }).catch(() => {});
    }
  }, [clearSessionOperation]);

  return {
    streamingReply,
    streamingReasoning,
    pendingPrompt,
    streamingToolState,
    streamingTikzSvg,
    abortControllerRef: streamAbortControllerRef,
    subscribeToStream,
    handleSend,
    handleStopStreaming,
    handleUploadAttachment,
  };
}
