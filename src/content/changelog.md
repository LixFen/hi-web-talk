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
