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
