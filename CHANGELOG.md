# Changelog

## [Unreleased]

## [0.5.0] - 2026-04-03

### Added
- **"Why this tag?" diagnostics**: right-click any message to see why it was tagged (or why it wasn't)
- **Classification diagnostics in progress window**: shows tier (headers/sender-cache/AI) per email during bulk classify
- **Tag preset modes**: Home (10 tags), Business (10 tags), Minimal (4 tags), or Custom
- **Analyze Inbox**: AI-powered tag discovery — samples your inbox and suggests categories
- **Chatbox refinement**: type natural language to adjust suggested tags ("add a health tag", "fewer categories")
- **Tag-to-folder routing**: automatically move classified emails to matching folders
- **Tag priority system**: drag-to-reorder tag priority for multi-tag folder routing
- **Auto-folder creation**: folders are created automatically on first use (Home: flat, Business: grouped under Sorted/)
- New permissions: `messagesMove`, `accountsFolders`
- 72 new tests (149 total): diagnostics, analyzer, folder-router modules
- `complete()` export on all provider modules for custom prompts

### Changed
- `DEFAULT_TAGS` now uses the Home preset (10 tags including health)
- `TAG_COLORS` expanded to 19 colors covering all preset tags
- Mode selector above tags in settings replaces tag list on switch
- Adding/removing individual tags auto-switches to Custom mode

## [0.4.0] - 2026-04-02

### Added
- Tiered classification pipeline: header scan (Tier 0) → sender cache (Tier 1) → LLM (Tier 2)
- Header-based pre-classification: List-Unsubscribe, Precedence, noreply detection skip the API entirely
- Sender reputation cache: remembers tags for known senders (2+ match threshold, LRU eviction at 500 entries)
- User correction feedback: messenger.messages.onUpdated listener updates sender cache when user changes tags
- Batch result count validation: warns on mismatch between input and output count
- normalizeSender() and classifyFromHeaders() exported as testable pure functions
- 18 new unit tests for header classification, sender normalization

## [0.3.0] - 2026-04-02

### Added
- Data consent screen shown on install — Mozilla policy compliant
- Consent status banner in settings page
- All classification gated behind explicit user consent
- SHA-256 update hash in updates.json for download integrity
- Unit tests for all pure functions and provider modules (42 tests)
- HTML stripping for email bodies (removes script/style/tags before sending to AI)
- In-memory deduplication to prevent classifying the same message twice
- Retry queue cap (200 messages max)
- Retry processing lock to prevent overlapping runs
- Failed batch emails now queued for individual retry
- issues.md tracking known bugs and security items
- LICENSE (MIT)
- CHANGELOG

### Changed
- Gemini API key moved from URL query parameter to x-goog-api-key header
- API error messages truncated to 200 characters (prevents key/data leakage)
- All provider response parsing uses safeParseJSON (handles markdown fences)
- All provider responses validated with optional chaining before property access
- Manifest description now discloses data transmission to AI providers
- Console logs use message IDs instead of email subjects
- innerHTML replaced with safe DOM API for key hint links
- release.sh now computes and includes SHA-256 hash in updates.json
- progress.js loaded as ES module for consistency

### Fixed
- Batch classification failure silently dropped all emails (no retry)
- Retry queue could grow unbounded with persistent API failures
- Concurrent retry processing could cause duplicate classifications
- Same message classified twice when new mail arrived during folder scan

## [0.2.0] - 2026-04-02

### Added
- Multi-provider support: Gemini, OpenAI, Anthropic, Fireworks, OpenRouter, Groq, Together, Ollama
- Auto-detect models from each provider's API with full pagination
- Simplified settings UI: provider dropdown + API key field
- Advanced model picker with search/filter
- Batch classification with progress window and cancel button
- Context menu: right-click to classify selected messages
- Toolbar button: classify entire folder
- New mail auto-classification listener
- Retry queue for failed classifications
- Auto-update via Thunderbird's built-in system (update_url + updates.json)
- GitHub Releases distribution with release.sh automation

### Removed
- Python backend (service/, tests/, pyproject.toml, thundersorter.service)
- .env.example (secrets never committed)

## [0.1.0] - 2026-04-01

### Added
- Initial Thundersorter implementation with Gemini-only classification
