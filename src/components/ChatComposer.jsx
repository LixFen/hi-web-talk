import React, { useRef, useState, useEffect } from 'react';
import BlockSelector from './BlockSelector';

const ChatComposer = ({
  isLoading,
  canStop = false,
  modelOptions = [],
  selectedModelId = "",
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
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (text.trim() && !isLoading) {
      onSend(text);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
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
              aria-label={isCollapsed ? '展开输入框' : '收起输入框'}
            >
              {isCollapsed ? '展开输入框' : '收起输入框'}
            </button>
          </div>
        ) : null}
        {!isCollapsed ? (
          <>
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder={"消息发送给 AI..."}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            className={`send-button ${canStop ? 'stop' : ''}`.trim()}
            type="button"
            onClick={canStop ? onStop : handleSend}
            disabled={canStop ? false : !text.trim() || isLoading}
            aria-label={canStop ? '停止生成' : '发送消息'}
          >
            {canStop ? (
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 7h10v10H7z" />
              </svg>
            ) : isLoading ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="16" height="16">
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
              aria-label={"选择当前发送模型"}
            >
              {modelOptions.length === 0 ? (
                <option value="">{"暂无可用模型"}</option>
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
            {"AI 可能会犯错。请核实重要信息。"}
          </div>
        </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default ChatComposer;
