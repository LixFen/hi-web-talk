import React, { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLocale } from "../contexts/LocaleContext";
import { useSession } from "../contexts/SessionContext";

const PAGE_SIZE = 20;

export default function SearchModal({ open, onClose }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { sessionSummaries, selectConversation, focusBlock, activateBlock, issueChatNavigationRequest } = useSession();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setOffset(0);
      setHasMore(false);
      setHasSearched(false);
      // Focus input on open
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Search function
  const performSearch = useCallback(async (searchQuery, currentOffset = 0) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasMore(false);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          offset: currentOffset,
          limit: PAGE_SIZE,
        }),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();

      if (currentOffset === 0) {
        setResults(data.results || []);
      } else {
        setResults((prev) => [...prev, ...(data.results || [])]);
      }
      setHasMore(data.hasMore || false);
      setOffset(currentOffset + PAGE_SIZE);
    } catch (error) {
      console.error("Search error:", error);
      setResults([]);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle search button click or Enter key
  const handleSearch = useCallback(() => {
    performSearch(query, 0);
  }, [query, performSearch]);

  // Handle Enter key
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  // Load more results
  const handleLoadMore = useCallback(() => {
    performSearch(query, offset);
  }, [query, offset, performSearch]);

  // Handle result click - navigate to conversation and focus block
  const handleResultClick = useCallback(async (result) => {
    const { sessionHash, blockSHA1 } = result;

    // Navigate to the conversation
    if (sessionHash) {
      const detail = await selectConversation(sessionHash);
      navigate(`/chat/${sessionHash}`);

      // Focus and activate the block after navigation
      // Wait for state to be fully updated
      if (blockSHA1 && detail) {
        // Use a longer delay to ensure state is updated
        setTimeout(() => {
          activateBlock(blockSHA1, sessionHash);
          // Use issueChatNavigationRequest to trigger smooth scroll to the block
          issueChatNavigationRequest("search-jump", "smooth", blockSHA1);
        }, 500);
      }
    }

    onClose();
  }, [selectConversation, navigate, activateBlock, issueChatNavigationRequest, onClose]);

  // Highlight search query in text
  const highlightText = useCallback((text, query) => {
    if (!query || !text) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    );
  }, []);

  // Format timestamp
  const formatTime = useCallback((timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("search.timeJustNow");
    if (diffMins < 60) return t("search.timeMinutes", { count: diffMins });
    if (diffHours < 24) return t("search.timeHours", { count: diffHours });
    if (diffDays < 7) return t("search.timeDays", { count: diffDays });

    return date.toLocaleDateString();
  }, [t]);

  if (!open) {
    return null;
  }

  return (
    <div className="search-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("search.title")}>
      <div className="search-modal">
        <div className="search-modal-header">
          <div className="search-modal-title-area">
            <div className="search-eyebrow">{t("search.eyebrow")}</div>
            <h2 className="search-modal-title">{t("search.title")}</h2>
          </div>
          <button type="button" className="topbar-btn subtle" onClick={onClose}>
            {t("search.close")}
          </button>
        </div>

        <div className="search-input-area">
          <div className="search-input-wrapper">
            <svg
              className="search-input-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button
            type="button"
            className="search-submit-btn"
            onClick={handleSearch}
            disabled={!query.trim() || isLoading}
          >
            {isLoading ? t("search.searching") : t("search.search")}
          </button>
        </div>

        <div className="search-results-area">
          {isLoading && results.length === 0 ? (
            <div className="search-loading">{t("search.loading")}</div>
          ) : results.length === 0 ? (
            <div className="search-empty">
              {!hasSearched
                ? t("search.pressToSearch")
                : query.trim()
                  ? t("search.noResults")
                  : t("search.hint")}
            </div>
          ) : (
            <>
              <div className="search-results-count">
                {t("search.resultCount", { count: results.length })}
              </div>
              <div className="search-results-list">
                {results.map((result, index) => (
                  <button
                    key={`${result.sessionHash}-${result.blockSHA1}-${index}`}
                    type="button"
                    className="search-result-item"
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="search-result-header">
                      <span className="search-result-session-title">
                        {highlightText(result.sessionTitle || t("search.untitled"), query)}
                      </span>
                      <span className="search-result-time">
                        {formatTime(result.timestamp)}
                      </span>
                    </div>
                    <div className="search-result-content">
                      {highlightText(result.content, query)}
                    </div>
                  </button>
                ))}
              </div>
              {hasMore && (
                <button
                  type="button"
                  className="search-load-more-btn"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                >
                  {isLoading ? t("search.loading") : t("search.loadMore")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
