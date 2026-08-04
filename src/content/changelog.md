# 2.1.0

- Fix: improved API support stabilitty.
- Feat: Added WorkStation mode blueprint(not fully implement yet).

# 2.0.1

- Fix: GraphView crash caused by referencing offsetX/offsetY before initialization.
- Feat: Auto-generate session title after the first AI response (toggle in Interaction Settings).

# 2.0.0

- Feat: TikZ drawing panel — new preview panel for LaTeX/TikZ diagrams with syntax checking, image generation, and display in message list.
- Feat: Drawing tools infrastructure — checkDrawing and drawTikz server tools with i18n support and session integration.
- Refactor: Harness adapter improvements — enhanced baseLLMAdapter, web search tool integration, and tool infrastructure refinements.
- Style: Blockquote styling — refined borders, padding, and visual spacing in markdown CSS for improved readability.
- Feat: Comprehensive test suite — vitest setup with unit tests for user service, memory cache, model capabilities, and schema validation.
- Chore: vitest configuration and test scripts added to package.json.
- Fix: Block selector navigation scroll — changed smooth scrolling to auto scrolling to prevent scroll behavior issues.

# 1.19.2

- Perf: Electron startup — disable GPU acceleration to eliminate 5-15s delay before launcher window appears on Windows.
- Chore: Electron NSIS installer — build portable and installable variants with desktop/start menu shortcuts.
- Chore: CI release workflow — upload both .exe and .exe.blockmap artifacts.
- Chore: Ignore .npmrc in version control.

# 1.19.1

- Feat: Password change in Account settings — users can now change their password from Settings > Account with old password verification and bcrypt re-hashing.
- Feat: Account settings panel — new settings section with change password form (current password, new password, confirm).
- Feat: Server-side change-password API — POST /api/auth/change-password with JWT auth, rate limiting, and Zod validation.
- Chore: i18n keys for account section — zh-CN and en-US translations for the new password change UI.

# 1.19.0

- Feat: sql.js adapter in database layer — Android uses WASM-based SQLite while desktop keeps better-sqlite3.
- Feat: Android APK build pipeline — Capacitor + nodejs-mobile bundles Express backend and React frontend into a single app.
- Fix: node-fetch/undici compatibility — polyfill File global for nodejs-mobile's Node 18 runtime.
- Fix: Android edge-to-edge layout — use 100dvh instead of 100vh, add safe-area-inset padding, enable viewport-fit=cover.
- Fix: Prevent Android WebView from opening external browser — allowNavigation config for localhost.

# 1.18.5

- Fix: Use 512×512 PNG icon for Electron builds — resolves "icon must be at least 256×256" build error.
- Chore: Grant write permissions to CI workflows — fixes 403 error when creating GitHub Releases.
- Chore: Upload Android APK directly to GitHub Release alongside the desktop installer.

# 1.18.4

- Feat: Add Badges display using models.
- Feat: Add document processing (PDF/DOCX/TXT) with runtime text injection
- Feat: Model badge in message-badges area
- Fix: extractAttachmentIds now handles document_attachment blocks
- Refactor: attachmentResolver supports document_attachment via documentParser
- Style: Document attachment display in composer, messages, and block card
- Feat: Right-click user message → "Edit message" — branches from previous block and fills composer
- Feat: Redesigned sidebar conversation list — three-dots menu for rename/delete/regenerate, added chat icon
- Style: Added border outlines to toggle, search, and logout buttons for consistency
- Style: Collapsed sidebar toggle and new-chat buttons unified to same size with adjusted spacing
- Style: Added horizontal padding to bottom dock branches panel to prevent card overflow

# 1.18.3

- Feat: Free Bing HTML search as default engine — no API key needed out of the box.
- Feat: Rich search source cards — favicon, title, snippet, domain displayed in card layout.
- Feat: Streaming search status — shows engine name, result count during search.
- Feat: Runtime search engine switching — dropdown in ChatComposer footer, persist per user.
- Feat: Search source images — thumbnails displayed in source cards when available.
- Feat: Citation annotations — sources get citationId, LLM prompted to cite with [citation:ID], rendered as clickable links.
- Feat: Collapsible search sources — default collapsed, smooth expand/collapse animation.
- Feat: Tool call logging in reasoning panel — search queries shown in thinking rounds.
- Feat: Search engine API config UI — configure API keys for Brave, Bing, Google, SearXNG in Interaction Settings.
- Feat: searchSourcesCollapsed user setting — control default collapse behavior of source cards.
- Fix: normalizeMessages strips tool_call_id — OpenAI adapter now preserves tool_call_id and tool_calls in message mapping.
- Fix: areRowPropsEqual missing visibleToolbarDefinitions — adaptation buttons now appear after async bootstrap.
- Fix: currentViewMode priority inverted — local viewMode takes precedence over server state, fixing composer hiding on rapid view switch.
- Fix: BlockCard ReasoningPanel doesn't handle array reasoning — single/multi-round reasoning now supported.
- Fix: parseModelPayload missing supportsToolUse — model tool use capability now persists on create/update.
- Fix: createModel alias collision — auto-disambiguates by appending -N suffix when user didn't provide explicit alias.
- Refactor: searchProviders.js uses builder pattern — accepts user config overrides merged with env vars.
- Refactor: Bing HTML search uses cheerio — CSS selector parsing instead of fragile regex.
- Chore: add cheerio dependency.

# 1.18.2

- Feat: block-selector nolonger display root block.

# 1.18.1

- Feat: touch pattern has batter performence now. 

# 1.18.0

- Feat: allow user create custom system prompt.

# 1.17.1

- Feat: Invite code registration — Admin can require an invite code for new user registration via Interaction Settings → Admin panel.

# 1.17.0

- Feat: Web search — AI can now automatically invoke search engines to fetch real-time information (weather, news, stock prices, etc.) and inject results as context into responses.
- Feat: Tool Calling infrastructure — LLM adapter layer supports function calling loops, laying the foundation for future tool extensions.
- Feat: Search mode toggle — ChatComposer footer provides a 🔍 button with auto/on/off search modes.
- Feat: Multi-round reasoning display — ReasoningPanel supports JSON array format, showing each reasoning round from tool calling separately.
- Feat: Search source display — Response footer shows clickable source links from search results.
- Feat: Model toolUse toggle — Model settings now include a "Tool Use" checkbox to manually override auto-detected capabilities.
- Feat: SSE protocol extension — New `tool_start`, `tool_result`, `reasoning_round` event types.
- Feat: Configurable search engine — Supports Brave Search, Bing, Google Custom Search, and SearXNG, switchable via environment variables.
- Feat: Block meta extension — Search info (queries, sources) stored in `block.meta.search`, backward compatible with old data.
- Feat: Reasoning format upgrade — `block.reasoning` changed from string to JSON array, with automatic backward compatibility for old data.
- Refactor: BaseLLMAdapter adds `callWithTools`/`streamWithTools` methods; tool calling loop is encapsulated within the adapter, transparent to the Block layer.
- Refactor: All four LLM adapters (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Google GenAI) now implement tool calling support.

# 1.16.1

- Feat: Added Search bar for history conversations.
- Feat: improved UI visual effects, including view switch and minor effects.
- Feat: more I18n content added.
- Feat: added viewmode switcher, Toast exit animations.
- Refactor: split monolithic `app.css` (4420 lines) into 9 modular CSS files (layout, messages, composer, dock, views, settings, components, animations, responsive) for better maintainability.
- Fix: merged duplicate selectors in `markdown.css` for `.markdown-body :not(pre) > code`.
- Fix: Fixed the context menu position issue.

# 1.16.0

- Fix: sending a message with images now correctly displays the user bubble during LLM streaming, matching the behavior of plain text messages.
- Feat: user message bubble now renders images above text for better visual hierarchy.
- Feat: chat composer is no longer rendered in chain/graph view modes (only visible in chat view).
- Feat: added SVG icon for the "hide branch" adaptation button, consistent with other adaptation button icons.
- Feat: introduced Provider entity — API endpoint and credentials are now managed at the Provider level; models inherit from their Provider and no longer duplicate provider config.
- Feat: model aliases are auto-generated as `providerSlug:modelName` when creating under a Provider.
- Feat: model capabilities (multimodal, reasoning, context window) are auto-inferred from models.dev at build time and pre-filled on model creation.
- Feat: added `npm run fetch:model-capabilities` script to refresh the model capability snapshot.
- Feat: LLM adapters now extend a shared `BaseLLMAdapter` base class with unified retry logic (5xx exponential backoff).
- Feat: model management sidebar now uses a tree layout (Provider → Models); model selector is grouped by Provider.
- Feat: Provider CRUD — create, edit, and delete Providers with independent Base URL and credentials.
- Fix: auto-migrate existing flat model records to Provider + Model structure on first startup; existing aliases are preserved.
- Fix: sending a message after hiding the active chain now correctly attaches the reply to the nearest visible ancestor instead of the hidden block.
- Feat: clicking a hidden node in graph view (show-hidden mode) no longer activates it — only visible nodes can be navigated to.

# 1.15.4

- Fix: changed enum of validation for dark mode
- Fix: modifying a saved model's configuration (without clearing the stored API key) no longer silently wipes the encrypted key.
- Fix: credential cache is now cleared immediately after a model update, preventing stale keys from being used.
- Graph view detail panel now floats over the graph canvas instead of occupying a fixed side column.
- Graph view supports Ctrl+scroll zoom with two levels: compact (sha1 only) and standard; zoom centers on the mouse pointer position.
- Feat: when switching to a model that does not support multimodal input, images in the conversation context are replaced with text placeholders indicating the current model cannot view the image.

# 1.15.3

- Now attchments can be displayed in BlockView mode.
- Empty session directory no longer generated.

# 1.15.2
- Change msg.content to msg.text to ensure that multimodal messages (image + text) enter the correct rendering path.
- Removed the unauthenticated legacy `POST /api/chat` endpoint that allowed anonymous LLM calls.
- Removed dead `authenticateTokenOrQuery` middleware and query-parameter token fallback to prevent JWT leakage in URLs.
- Enabled Content-Security-Policy header to restrict script, style, font, and connection sources.
- Migrated primary authentication to httpOnly cookies; frontend now sends `credentials: "same-origin"` with Bearer token as fallback.

# 1.15.1

- Added a new "About and Version" settings sub-page to uniformly display version information.
- Complete the frontend localized text.
- The update log is read and rendered from a standalone Markdown file.
