import React, { useRef, useState, useEffect, useCallback } from 'react';
import BlockSelector from './BlockSelector';
import { getAttachmentUrl } from '../lib/chatApi';
import { useLocale } from '../contexts/LocaleContext';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageOnce(file, maxLongSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;
      const longSide = Math.max(width, height);
      if (longSide > maxLongSide) {
        const ratio = maxLongSide / longSide;
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob failed'));
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function compressImage(file, maxLongSide = 2048) {
  const TARGET_MAX_BYTES = 500 * 1024;
  let quality = 0.75;
  let currentMaxLongSide = maxLongSide;

  while (true) {
    const blob = await compressImageOnce(file, currentMaxLongSide, quality);
    if (blob.size <= TARGET_MAX_BYTES || quality <= 0.4) {
      return blob;
    }
    quality -= 0.1;
    if (quality < 0.5 && currentMaxLongSide > 1024) {
      currentMaxLongSide = Math.round(currentMaxLongSide * 0.75);
      quality = 0.75;
    }
  }
}

function getMaxLongSide(modelOptions, selectedModelId) {
  const model = modelOptions.find((m) => m.alias === selectedModelId);
  if (model?.providerType === 'anthropic') return 1568;
  return 2048;
}

const ChatComposer = ({
  isLoading,
  canStop = false,
  modelOptions = [],
  providers = [],
  selectedModelId = "",
  searchMode = "auto",
  onSearchModeChange,
  isCollapsed = false,
  onToggleCollapsed,
  onChangeModel,
  onSend,
  onStop,
  hideToolbar = false,
  blocks = [],
  focusedBlockSHA1,
  activeBlockSHA1,
  onSelectBlock,
  onUploadAttachment,
  sessionHash,
}) => {
  const { t } = useLocale();
  const MAX_ATTACHMENTS = 10;

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const textareaRef = useRef(null);
  const prevSessionHashRef = useRef(sessionHash);
  const onUploadAttachmentRef = useRef(onUploadAttachment);
  const uploadingRef = useRef(false);
  const attachmentsRef = useRef(attachments);
  onUploadAttachmentRef.current = onUploadAttachment;
  attachmentsRef.current = attachments;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  useEffect(() => {
    const prev = prevSessionHashRef.current;
    prevSessionHashRef.current = sessionHash;

    if (!prev && sessionHash) {
      return;
    }

    if (prev === sessionHash) {
      return;
    }

    if (uploadingRef.current) {
      return;
    }

    setText('');
    setAttachments((prevAtts) => {
      prevAtts.forEach((a) => {
        if (a.isLocal && a.url) {
          URL.revokeObjectURL(a.url);
        }
      });
      return [];
    });
  }, [sessionHash]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"));
    const maxLongSide = getMaxLongSide(modelOptions, selectedModelId);

    for (const item of imageItems) {
      if (attachmentsRef.current.length >= MAX_ATTACHMENTS) break;

      const file = item.getAsFile();
      if (!file) continue;

      const fileName = file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`;
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      let compressedBlob;
      let previewUrl;
      try {
        compressedBlob = await compressImage(file, maxLongSide);
        previewUrl = URL.createObjectURL(compressedBlob);
      } catch (compressError) {
        console.error("图片压缩失败:", compressError);
        compressedBlob = file;
        previewUrl = URL.createObjectURL(file);
      }

      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        return [
          ...prev,
          {
            attachmentId: localId,
            fileName,
            mimeType: 'image/jpeg',
            url: previewUrl,
            isLocal: true,
          },
        ];
      });

      try {
        const base64Data = await readFileAsBase64(compressedBlob);
        const fn = onUploadAttachmentRef.current;
        if (!fn) {
          console.error('[ChatComposer] paste: onUploadAttachment is not set, keeping local preview');
          return;
        }

        uploadingRef.current = true;
        const result = await fn({
          fileName,
          mimeType: 'image/jpeg',
          base64Data,
        });
        uploadingRef.current = false;

        console.log('[ChatComposer] paste upload result:', result);

        if (result?.attachmentId) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.attachmentId === localId
                ? {
                    attachmentId: result.attachmentId,
                    fileName: result.fileName,
                    mimeType: result.mimeType,
                    url: getAttachmentUrl(result.attachmentId),
                  }
                : a
            )
          );
        } else {
          console.error('[ChatComposer] paste: upload returned no attachmentId, keeping local preview');
        }
      } catch (error) {
        uploadingRef.current = false;
        console.error('[ChatComposer] paste upload error:', error);
      }
    }
  }, [modelOptions, selectedModelId]);

  const handleAttachClick = useCallback(() => {
    if (isLoading) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (input.parentNode) input.remove();
      window.removeEventListener('focus', onWindowFocus);
    };

    const onWindowFocus = () => {
      setTimeout(cleanup, 800);
    };

    input.addEventListener('change', async (e) => {
      cleanup();
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const maxLongSide = getMaxLongSide(modelOptions, selectedModelId);

      for (const file of files) {
        if (attachmentsRef.current.length >= MAX_ATTACHMENTS) break;
        if (!file.type.startsWith("image/")) continue;

        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

        let compressedBlob;
        let previewUrl;
        try {
          compressedBlob = await compressImage(file, maxLongSide);
          previewUrl = URL.createObjectURL(compressedBlob);
        } catch (compressError) {
          console.error("图片压缩失败:", compressError);
          compressedBlob = file;
          previewUrl = URL.createObjectURL(file);
        }

        setAttachments((prev) => {
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [
            ...prev,
            {
              attachmentId: localId,
              fileName: file.name,
              mimeType: 'image/jpeg',
              url: previewUrl,
              isLocal: true,
            },
          ];
        });

        try {
          const base64Data = await readFileAsBase64(compressedBlob);
          const fn = onUploadAttachmentRef.current;
          if (!fn) {
            console.error('[ChatComposer] onUploadAttachment is not set, keeping local preview');
            return;
          }

          uploadingRef.current = true;
          const result = await fn({
            fileName: file.name,
            mimeType: 'image/jpeg',
            base64Data,
          });
          uploadingRef.current = false;

          console.log('[ChatComposer] upload result:', result);

          if (result?.attachmentId) {
            setAttachments((prev) =>
              prev.map((a) =>
                a.attachmentId === localId
                  ? {
                      attachmentId: result.attachmentId,
                      fileName: result.fileName,
                      mimeType: result.mimeType,
                      url: getAttachmentUrl(result.attachmentId),
                    }
                  : a
              )
            );
          } else {
            console.error('[ChatComposer] upload returned no attachmentId, keeping local preview');
          }
        } catch (error) {
          uploadingRef.current = false;
          console.error('[ChatComposer] upload error:', error);
        }
      }
    });

    window.addEventListener('focus', onWindowFocus, { once: true });
    document.body.appendChild(input);
    input.click();

    setTimeout(cleanup, 60000);
  }, [isLoading, modelOptions, selectedModelId]);

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => {
      const toRemove = prev.find((a) => a.attachmentId === attachmentId);
      if (toRemove?.isLocal && toRemove.url) {
        URL.revokeObjectURL(toRemove.url);
      }
      return prev.filter((a) => a.attachmentId !== attachmentId);
    });
  };

  const handleSend = () => {
    const trimmedText = text.trim();
    const readyAttachments = attachments.filter((a) => !a.isLocal);
    const hasContent = trimmedText || readyAttachments.length > 0;

    if (!hasContent || isLoading) return;

    if (readyAttachments.length === 0) {
      onSend(trimmedText);
    } else {
      const content = [];
      if (trimmedText) {
        content.push({ type: "text", text: trimmedText });
      }
      for (const attachment of readyAttachments) {
        content.push({
          type: "image_attachment",
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        });
      }
      onSend(content);
    }

    setText('');
    setAttachments((prev) => {
      prev.forEach((a) => {
        if (a.isLocal && a.url) {
          URL.revokeObjectURL(a.url);
        }
      });
      return [];
    });
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className={`composer-area ${hideToolbar ? 'no-toolbar' : ''} ${isCollapsed ? 'collapsed' : ''}`.trim()}>
      <div className="composer-container">
        {!hideToolbar ? (
          <div className="composer-toolbar">
            <button
              className="composer-collapse-button"
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? t('app.expandInput') : t('app.collapseInput')}
            >
              {isCollapsed ? t('app.expandInput') : t('app.collapseInput')}
            </button>
          </div>
        ) : null}
        {!isCollapsed ? (
          <>
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div key={attachment.attachmentId} className="composer-attachment-item">
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  className="composer-attachment-thumb"
                />
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => removeAttachment(attachment.attachmentId)}
                    title={t('app.removeImage')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder={t('app.messagePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading}
          />
          <button
            type="button"
            className="composer-attach-btn"
            onClick={handleAttachClick}
            disabled={isLoading}
            title={t('app.uploadImage')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <button
            className={`send-button ${canStop ? 'stop' : ''}`.trim()}
            type="button"
            onClick={canStop ? onStop : handleSend}
            disabled={canStop ? false : (!text.trim() && !attachments.some((a) => !a.isLocal)) || isLoading}
            aria-label={canStop ? t('app.stopGenerating') : t('app.sendMessage')}
          >
            {canStop ? (
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 7h10v10H7z" />
              </svg>
            ) : isLoading ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="16" height="16" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 4a1 1 0 0 1 .707.293l6 6a1 1 0 0 1-1.414 1.414L13 7.414V19a1 1 0 1 1-2 0V7.414l-4.293 4.293a1 1 0 1 1-1.414-1.414l6-6A1 1 0 0 1 12 4Z" />
              </svg>
            )}
          </button>
        </div>
        <div className="chat-footer-bar">
          <div className="chat-footer-controls">
            <select
              className="composer-model-selector"
              value={selectedModelId}
              onChange={(e) => onChangeModel?.(e.target.value)}
              disabled={isLoading || modelOptions.length === 0}
              aria-label={t('app.currentModel')}
            >
              {modelOptions.length === 0 ? (
                <option value="">{t('app.noAvailableModel')}</option>
              ) : providers.length > 0 ? (
                (() => {
                  // Group models by provider
                  const providerMap = new Map();
                  for (const p of providers) {
                    providerMap.set(p.providerId, { provider: p, models: [] });
                  }
                  const legacy = [];
                  for (const m of modelOptions) {
                    if (m.providerId && providerMap.has(m.providerId)) {
                      providerMap.get(m.providerId).models.push(m);
                    } else {
                      legacy.push(m);
                    }
                  }
                  const groups = [];
                  for (const [, group] of providerMap) {
                    if (group.models.length > 0) {
                      groups.push(group);
                    }
                  }
                  if (legacy.length > 0) {
                    groups.push({ provider: { name: t("common.other") }, models: legacy });
                  }
                  return groups.map((group) => (
                    <optgroup key={group.provider.name} label={group.provider.name}>
                      {group.models.map((m) => (
                        <option key={m.alias} value={m.alias}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ));
                })()
              ) : (
                modelOptions.map((option) => (
                  <option key={option.alias} value={option.alias}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
            <BlockSelector
              blocks={blocks}
              focusedBlockSHA1={focusedBlockSHA1}
              activeBlockSHA1={activeBlockSHA1}
              onSelectBlock={onSelectBlock}
              disabled={isLoading}
            />
          </div>
          <div className="chat-footer-text">
            {onSearchModeChange && (() => {
              const currentModel = modelOptions.find((m) => m.alias === selectedModelId);
              const supportsToolUse = currentModel?.supportsToolUse ?? false;
              const searchModeClass = searchMode === "auto" ? "auto" : searchMode === "on" ? "on" : "off";
              const searchTitle = !supportsToolUse
                ? "当前模型不支持联网搜索"
                : searchMode === "auto"
                ? "联网搜索: 自动 (AI 自行判断)"
                : searchMode === "on"
                ? "联网搜索: 开启 (强制搜索)"
                : "联网搜索: 关闭";

              return (
                <button
                  type="button"
                  className={`composer-search-btn ${searchModeClass}`}
                  onClick={() => {
                    if (!supportsToolUse) return;
                    const next = searchMode === "auto" ? "on" : searchMode === "on" ? "off" : "auto";
                    onSearchModeChange(next);
                  }}
                  disabled={isLoading || !supportsToolUse}
                  title={searchTitle}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  {supportsToolUse && (
                    <span className="composer-search-indicator">
                      {searchMode === "auto" ? "自动" : searchMode === "on" ? "开启" : "关闭"}
                    </span>
                  )}
                </button>
              );
            })()}
            {t('app.aiWarning')}
          </div>
        </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default ChatComposer;
