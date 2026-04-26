# Performance Optimization Plan

## Phase 1: Streaming Re-render Fix (highest impact)

### 1.1 Replace `streamingReply` useState with useRef + flush pattern
- **File**: `src/App.jsx`
- **Problem**: `setStreamingReply` fires on every SSE delta (50-200+ times/sec), cascading full-tree re-renders through ChatView → MessageList → every message row with ReactMarkdown
- **Fix**: 
  - Keep `streamingReply` as a `useRef` for accumulation during streaming
  - Use `useState` only for a "display" version flushed at throttled intervals (e.g., 60ms via requestAnimationFrame)
  - Move `pendingPrompt` to same throttled pattern
  - `shouldShowPendingUserMessage` / `shouldShowPendingAssistantMessage` check the display state, not the raw accumulator

### 1.2 Memoize `MessageList` message rows
- **File**: `src/components/MessageList.jsx`
- **Problem**: Every message row re-renders on every parent update, including expensive `ReactMarkdown` with KaTeX + highlight.js
- **Fix**:
  - Extract message row rendering into `MessageRow` component wrapped with `React.memo`
  - Compare by `msg.id + msg.text + msg.blockSHA1 === focusedBlockSHA1` (the only things that change)
  - Pre-compute `normalizedMessageText` and `normalizedPrev/NextBranchFlowText` outside the memo boundary (compute once in `getSessionDetail` or a top-level useMemo)

## Phase 2: Backend compute reduction

### 2.1 Optimize `getSessionDetail` - reduce full recompute on every mutation
- **File**: `server/services/sessionService.js`
- **Problem**: Called after every reply/branch/regenerate/adaptation. Always re-fetches ALL blocks + summaries + adaptations, rebuilds all block view models (recursive depth calc O(n²))
- **Fix**:
  - Save block depth in the `blocks` table during `createDialogueBlock` / `saveBlock` (add `depth INTEGER` column, compute once on creation)
  - Store depth in block `meta` field (no schema change needed): `meta.depth = parentDepth + 1`
  - Read depth from meta in `getBlockDepth` before falling back to recursive calc
  - Remove `sortBlocksByCreatedAt` — `listBlocks` already queries with `ORDER BY createdAt, sha1`

### 2.2 Scope `buildContextForActiveBlock` queries to active chain
- **File**: `server/services/contextBuilderService.js`
- **Current**: Fetches ALL adaptations and ALL summaries for the session
- **Fix**:
  - First read `getChainBlocks` (already done) to get active chain SHA1s
  - Pass chain block SHA1s to `getSessionAdaptationMap` / `listSummaries` filtered queries
  - Or add filtered query variants: `getAdaptationMapForBlocks(sessionHash, sha1List)`

### 2.3 Reuse pre-fetched data in streaming reply flow
- **File**: `server/index.js` (reply/stream handler ~line 700)
- **Problem**: `getSessionDetail()` re-fetches all blocks/adaptations/summaries right after `buildContextForActiveBlock()` already fetched them
- **Fix**:
  - Return adaptation/summary data from `buildContextForActiveBlock` alongside context messages
  - Pass cached data to a new lightweight `getSessionDetailWithCache()` variant that skips re-fetching
  - Or add an optional `contextCache` parameter to `getSessionDetail`

### 2.4 Remove needless count queries in delete operations
- **Files**: `server/services/blockAdaptationService.js:198-209`, `server/services/summaryService.js:97-108`
- **Problem**: Calls `listRecords` before AND after delete, just to return count
- **Fix**: Use `db.prepare(...).run().changes` (better-sqlite3 returns `changes` count from `.run()`)

### 2.5 Cache decrypted credentials per request
- **File**: `server/services/modelConfigService.js` (`resolveModelCredential`)
- **Problem**: `decryptApiKey` called on every `callProviderModel`/`streamProviderModel` call
- **Fix**: Instance-scoped Map cache keyed by model alias, cleared after 30s TTL or used as request-scoped cache

## Phase 3: Frontend memoization & derived value cleanup

### 3.1 Convert derived values to useMemo
- **File**: `src/App.jsx`
- **Items to memoize**:
  - `sidebarConversations` (line 952-955) → `useMemo([sessionSummaries])`
  - `enabledModels` (line 254) → `useMemo([modelOptions])`
  - `selectedModel` (line 300-303) → `useMemo([enabledModels, selectedModelId])`
  - `hasStartedConversation` → derive from `displayMessages` memo
  - `isAnySettingsPanelOpen` → `useMemo` instead of inline logical OR
  - `shouldHideComposer` → `useMemo`
  - `focusedBlockSHA1` → `useMemo`

### 3.2 Memoize child components in renderWorkspace
- **File**: `src/App.jsx`
- **Fix**:
  - Wrap `ChatView`, `ChainCardView`, `GraphView` with `React.memo`
  - Move `renderWorkspace` content into a separate memoized `Workspace` component
  - Ensure prop objects passed to child components use `useMemo` to maintain referential stability

### 3.3 Reduce useCallback dependency drift
- **File**: `src/components/MessageList.jsx:266` — `handleReadBlockChange` depends on `readBlockSHA1` (frequently changing `useState`)
- **Fix**: Use ref for `readBlockSHA1` instead of including it in dependencies

## Phase 4: Pre-compute & data shape improvements

### 4.1 Pre-compute markdown normalization at API layer
- **Files**: `server/services/sessionService.js`, `src/components/MessageList.jsx`
- **Problem**: `normalizeMarkdownMath()` runs on every message in every render
- **Fix**: Server-side normalization of math delimiters in `buildChainChatMessages()`, store in new field `normalizedText`, frontend reads it directly

### 4.2 Pre-compute branch flow text server-side
- **Files**: `server/services/sessionService.js` (`buildBlockViewModels`)
- **Problem**: `buildBranchFlowTextFromGraph` runs twice per assistant message in render (map lookups + string processing)
- **Fix**: Add `previousBranchFlowText` and `nextBranchFlowText` to `branchInfo` during `buildBlockViewModels()`

### 4.3 Batch adaptation/summary writes
- **File**: `server/services/sessionService.js` (reply/stream handlers)
- **Problem**: `createDialogueBlock` + `updateSession` + syncSummaryAdaptation are sequential writes
- **Fix**: Wrap in `db.transaction()` (SQLite already uses WAL, but explicit transactions reduce fsync overhead)

## Phase 5: Verification

### 5.1 Confirm no regressions
- Run `npm run build` to verify frontend compiles
- Manual smoke test: send message, stream reply, switch branches, regenerate
- Verify message rendering still works correctly (math, code highlighting, branch previews)

## Priority Order

1. **Phase 1** (streaming fix) — biggest visible improvement, touches most user interactions
2. **Phase 2.1 + 2.2 + 2.3** — backend compute reduction, faster response times
3. **Phase 3** — frontend memoization (lower effort, solid gains)
4. **Phase 2.4 + 2.5** — quick backend wins
5. **Phase 4** — data shape improvements (medium effort)
6. **Phase 5** — verification
