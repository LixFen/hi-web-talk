import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createSession,
  sendReply,
  sendReplyStream,
  subscribeToSessionStream,
  uploadAttachment,
} from "../lib/chatApi";

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
  const streamAbortControllerRef = useRef(null);
  const streamReconnectControllerRef = useRef(null);
  const streamBufferRef = useRef("");
  const streamReasoningBufferRef = useRef("");
  const streamFlushRafRef = useRef(0);

  function scheduleFlush() {
    if (streamFlushRafRef.current) return;
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = 0;
      setStreamingReply(streamBufferRef.current);
      setStreamingReasoning(streamReasoningBufferRef.current);
    });
  }

  const subscribeToStream = useCallback(
    async (sessionHash) => {
      streamReconnectControllerRef.current?.abort();

      const abortController = new AbortController();
      streamReconnectControllerRef.current = abortController;

      onSetLoading(true);
      setStreamingReply("");
      setStreamingReasoning("");
      setStreamingToolState(null);
      setStreamingTikzSvg(null);
      streamBufferRef.current = "";
      streamReasoningBufferRef.current = "";

      try {
        const result = await subscribeToSessionStream(sessionHash, {
          signal: abortController.signal,
          onEvent: (event) => {
            // 处理工具事件
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
            // 处理 reasoning round 事件
            if (event?.type === "reasoning_round") {
              if (event.reasoningDelta) {
                streamReasoningBufferRef.current += `\n\n---\n\n${event.reasoningDelta}`;
              } else if (streamReasoningBufferRef.current) {
                streamReasoningBufferRef.current += `\n\n---\n\n`;
              }
              scheduleFlush();
              return;
            }
            if (event?.type === "delta") {
              streamBufferRef.current += event.delta || "";
              if (event.reasoningDelta || event.reasoning_delta) {
                streamReasoningBufferRef.current +=
                  event.reasoningDelta || event.reasoning_delta || "";
              }
              scheduleFlush();
              return;
            }
            if (event?.type === "complete") {
              onApplyDetail(event.detail);
              return;
            }
            if (event?.type === "error") {
              throw new Error(event.error || "流式重连出错。");
            }
          },
        });

        if (!result.active) {
          onSetLoading(false);
          setPendingPrompt("");
          setStreamingReply("");
          setStreamingReasoning("");
          setStreamingToolState(null);
          setStreamingTikzSvg(null);
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          onSetError(
            err instanceof Error ? err.message : "流式重连失败。",
          );
        }
      } finally {
        if (streamFlushRafRef.current) {
          cancelAnimationFrame(streamFlushRafRef.current);
          streamFlushRafRef.current = 0;
        }
        streamBufferRef.current = "";
        streamReasoningBufferRef.current = "";
        onSetLoading(false);
        setPendingPrompt("");
        setStreamingReply("");
        setStreamingReasoning("");
        setStreamingToolState(null);
        setStreamingTikzSvg(null);
        streamReconnectControllerRef.current = null;
      }
    },
    [onApplyDetail, onSetLoading, onSetError],
  );

  const handleUploadAttachment = useCallback(
    async ({ fileName, mimeType, base64Data }) => {
      let sessionHash = getSessionHash();
      if (!sessionHash) {
        const createdDetail = await createSession(systemPrompt?.content || "");
        onApplyDetail(createdDetail);
        sessionHash = createdDetail.session.sessionHash;
        navigate(`/chat/${sessionHash}`);
        return uploadAttachment({
          sessionHash,
          fileName,
          mimeType,
          base64Data,
        });
      }
      return uploadAttachment({ sessionHash, fileName, mimeType, base64Data });
    },
    [getSessionHash, systemPrompt, onApplyDetail],
  );

  const handleSend = useCallback(
    async (rawContent) => {
      const isArray = Array.isArray(rawContent);
      const textPreview = isArray
        ? rawContent.map((b) => b.text ?? "").join(" ").trim()
        : rawContent.trim();
      const model = selectedModel;
      if ((!textPreview && !isArray) || !model) return;

      onSetLoading(true);
      setPendingPrompt(rawContent);
      setStreamingReply("");
      setStreamingToolState(null);
      setStreamingTikzSvg(null);
      streamReconnectControllerRef.current?.abort();
      streamReconnectControllerRef.current = null;

      let sessionHash = getSessionHash() || "";
      const supportsStreaming = model.supportsStreaming !== false;

      try {
        if (!sessionHash) {
          const createdDetail = await createSession(systemPrompt?.content || "");
          onApplyDetail(createdDetail);
          sessionHash = createdDetail.session.sessionHash;
          navigate(`/chat/${sessionHash}`);
        }

        const prompt = isArray ? rawContent : rawContent.trim();

        if (!supportsStreaming) {
          const detail = await sendReply({
            sessionHash,
            prompt,
            modelAlias: model.alias,
            searchMode,
            searchEngine,
          });
          onApplyDetail(detail, {
            revealLatestInChat: true,
            reason: "send-reply",
            behavior: "auto",
          });
          return;
        }

        const abortController = new AbortController();
        streamAbortControllerRef.current = abortController;

        let streamedDetail = null;

        await sendReplyStream({
          sessionHash,
          prompt,
          modelAlias: model.alias,
          searchMode,
          searchEngine,
          signal: abortController.signal,
          onEvent: async (event) => {
            // 处理工具事件
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
            // 处理 reasoning round 事件
            if (event?.type === "reasoning_round") {
              if (event.reasoningDelta) {
                streamReasoningBufferRef.current += `\n\n---\n\n${event.reasoningDelta}`;
              } else if (streamReasoningBufferRef.current) {
                streamReasoningBufferRef.current += `\n\n---\n\n`;
              }
              scheduleFlush();
              return;
            }
            if (event?.type === "delta") {
              streamBufferRef.current += event.delta || "";
              if (event.reasoningDelta || event.reasoning_delta) {
                streamReasoningBufferRef.current +=
                  event.reasoningDelta || event.reasoning_delta || "";
              }
              scheduleFlush();
              return;
            }
            if (event?.type === "complete") {
              streamedDetail = event.detail;
              return;
            }
            if (event?.type === "error") {
              throw new Error(event.error || "请求失败了，请稍后再试。");
            }
          },
        });

        if (!streamedDetail) {
          throw new Error("流式请求未返回完成事件。");
        }

        onApplyDetail(streamedDetail, { revealLatestInChat: false });
      } catch (err) {
        if (err?.name === "AbortError") {
          onSetError("已停止生成。");
        } else {
          onSetError(
            err instanceof Error ? err.message : "请求失败了，请稍后再试。",
          );
        }
      } finally {
        if (streamFlushRafRef.current) {
          cancelAnimationFrame(streamFlushRafRef.current);
          streamFlushRafRef.current = 0;
        }
        streamBufferRef.current = "";
        streamReasoningBufferRef.current = "";
        onSetLoading(false);
        setPendingPrompt("");
        setStreamingReply("");
        setStreamingReasoning("");
        setStreamingToolState(null);
        setStreamingTikzSvg(null);
        streamAbortControllerRef.current = null;
      }
    },
    [selectedModel, searchMode, systemPrompt, getSessionHash, onApplyDetail, onSetLoading, onSetError],
  );

  const handleStopStreaming = useCallback(() => {
    streamAbortControllerRef.current?.abort();
  }, []);

  const abortControllerValue = streamAbortControllerRef;

  return {
    streamingReply,
    streamingReasoning,
    pendingPrompt,
    streamingToolState,
    streamingTikzSvg,
    abortControllerRef: abortControllerValue,
    subscribeToStream,
    handleSend,
    handleStopStreaming,
    handleUploadAttachment,
  };
}
