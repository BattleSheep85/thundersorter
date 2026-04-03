# Issues

Last updated: 2026-04-03

## Security

- [x] HIGH: Gemini API key passed in URL query parameter — moved to x-goog-api-key header
- [x] HIGH: API error responses echoed verbatim — truncated to 200 chars via apiError()
- [x] HIGH: No validation of API response structure — added optional chaining + type checks
- [x] HIGH: No data consent screen — built consent/consent.html with full Mozilla policy compliance
- [x] HIGH: Manifest description didn't disclose data transmission — updated
- [ ] MEDIUM: API keys stored in plaintext in messenger.storage.local (no encrypted storage API in Thunderbird — platform limitation, cannot fix)
- [x] MEDIUM: Anthropic requires `anthropic-dangerous-direct-browser-access` header for browser access — already set in anthropic.js
- [x] LOW: http://localhost/* permission broader than needed for Ollama — narrowed to port 11434

## Crashes

- [x] HIGH: JSON.parse on LLM responses crashes on malformed JSON — added safeParseJSON with fence stripping
- [x] HIGH: Deep property access on API responses (candidates[0].content) — added optional chaining
- [x] MEDIUM: Infinite loop risk if provider API always returns pagination token — added MAX_PAGES=20 guard in all providers

## Code Quality

- [x] HIGH: Batch failure dropped all emails silently — now queues for individual retry
- [x] HIGH: Retry queue grew unboundedly — capped at 200
- [x] HIGH: Overlapping retry queue processing — added retryInProgress lock
- [x] HIGH: Same message could be classified concurrently — added classifyingNow Set
- [x] HIGH: Raw HTML sent to LLM — added stripHtml() to strip tags/scripts/styles
- [x] MEDIUM: innerHTML used for key hint — replaced with DOM API
- [x] MEDIUM: Console logs exposed email subjects — changed to message IDs only
- [x] MEDIUM: No rate limiting between batch API calls — added 1s delay between batch iterations
- [x] MEDIUM: Progress messages broadcast to all extension pages — acceptable: listeners filter by type, sendMessage errors caught with .catch(() => {})
- [x] LOW: {tags} placeholder replacement uses .replace — switched to .replaceAll in all providers
- [x] LOW: No user feedback when toolbar button clicked without provider — now opens options/consent page

## Performance / Architecture

- [x] HIGH: Every email makes a full LLM API call — added header pre-classification (List-Unsubscribe, Precedence, noreply) as Tier 0
- [x] HIGH: No sender cache — added sender reputation cache with 2+ hit threshold and LRU eviction (Tier 1)
- [ ] MEDIUM: No subject-only fast path — full 4000-char body sent even when subject+sender alone are sufficient (80-95% token reduction for emails that don't need body)
- [x] MEDIUM: Batch classification trusts LLM to return results in correct order — added result count validation with console warning on mismatch
- [ ] LOW: 4000-char body truncation ignores email structure — forwarded/quoted emails may lose the important delta

## Feedback Loop

- [x] MEDIUM: No user correction detection — added onUpdated listener that updates sender cache when user changes ts_ tags
- [ ] LOW: Classification is permanent — no way to reclassify after model upgrade or tag list change (consider context menu "Reclassify" action)

## v0.5.0 Additions

- [x] HIGH: No way to understand why an email was/wasn't tagged — added "Why this tag?" diagnostics popup
- [x] HIGH: Tags are one-size-fits-all — added Home/Business/Minimal presets with mode selector
- [x] HIGH: No way to discover appropriate tags — added "Analyze Inbox" with AI-powered tag discovery
- [x] HIGH: No folder routing — added tag-to-folder routing with auto-folder creation
- [x] MEDIUM: resolveFolder case mismatch in priority lookup — normalized mapping keys to lowercase
- [x] MEDIUM: parseTagSuggestions recursive call could stack overflow — removed recursion
- [x] MEDIUM: drag-reorder splice ordering bug — replaced with filter+insert pattern
- [x] MEDIUM: No in-flight guard on Analyze Inbox — added analyzeInProgress guard
- [ ] LOW: pendingDiagnostic single-slot race (if two popups open simultaneously) — unlikely in practice

## UX

- [x] LOW: No folder exclusion — auto-classification now skips sent, drafts, trash, junk, templates, outbox folders
- [ ] LOW: No indication of API cost before classifying large folders
