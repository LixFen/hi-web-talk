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
  onApplyDetail,
  onSetLoading,
  onSetError,
}) {
  const navigate = useNavigate();
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
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
      streamBufferRef.current = "";
      streamReasoningBufferRef.current = "";

      try {
        const result = await subscribeToSessionStream(sessionHash, {
          signal: abortController.signal,
          onEvent: (event) => {
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
        streamReconnectControllerRef.current = null;
      }
    },
    [onApplyDetail, onSetLoading, onSetError],
  );

  const handleUploadAttachment = useCallback(
    async ({ fileName, mimeType, base64Data }) => {
      let sessionHash = getSessionHash();
      if (!sessionHash) {
        const createdDetail = await createSession();
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
    [getSessionHash, onApplyDetail],
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
      setPendingPrompt(textPreview || "[图片消息]");
      setStreamingReply("");
      streamReconnectControllerRef.current?.abort();
      streamReconnectControllerRef.current = null;

      let sessionHash = getSessionHash() || "";
      const supportsStreaming = model.supportsStreaming !== false;

      try {
        if (!sessionHash) {
          const createdDetail = await createSession();
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
          signal: abortController.signal,
          onEvent: async (event) => {
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
        streamAbortControllerRef.current = null;
      }
    },
    [selectedModel, getSessionHash, onApplyDetail, onSetLoading, onSetError],
  );

  const handleStopStreaming = useCallback(() => {
    streamAbortControllerRef.current?.abort();
  }, []);

  const abortControllerValue = streamAbortControllerRef;

  return {
    streamingReply,
    streamingReasoning,
    pendingPrompt,
    abortControllerRef: abortControllerValue,
    subscribeToStream,
    handleSend,
    handleStopStreaming,
    handleUploadAttachment,
  };
}
