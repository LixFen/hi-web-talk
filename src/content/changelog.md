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
