# Issues

Last updated: 2026-04-02

## Security

- [x] HIGH: Gemini API key passed in URL query parameter — moved to x-goog-api-key header
- [x] HIGH: API error responses echoed verbatim — truncated to 200 chars via apiError()
- [x] HIGH: No validation of API response structure — added optional chaining + type checks
- [x] HIGH: No data consent screen — built consent/consent.html with full Mozilla policy compliance
- [x] HIGH: Manifest description didn't disclose data transmission — updated
- [ ] MEDIUM: API keys stored in plaintext in messenger.storage.local (no encrypted storage API in Thunderbird)
- [ ] MEDIUM: Anthropic requires `anthropic-dangerous-direct-browser-access` header for browser access
- [ ] LOW: http://localhost/* permission broader than needed for Ollama (port 11434)

## Crashes

- [x] HIGH: JSON.parse on LLM responses crashes on malformed JSON — added safeParseJSON with fence stripping
- [x] HIGH: Deep property access on API responses (candidates[0].content) — added optional chaining
- [ ] MEDIUM: Infinite loop risk if provider API always returns pagination token (no max page guard)

## Code Quality

- [x] HIGH: Batch failure dropped all emails silently — now queues for individual retry
- [x] HIGH: Retry queue grew unboundedly — capped at 200
- [x] HIGH: Overlapping retry queue processing — added retryInProgress lock
- [x] HIGH: Same message could be classified concurrently — added classifyingNow Set
- [x] HIGH: Raw HTML sent to LLM — added stripHtml() to strip tags/scripts/styles
- [x] MEDIUM: innerHTML used for key hint — replaced with DOM API
- [x] MEDIUM: Console logs exposed email subjects — changed to message IDs only
- [ ] MEDIUM: No rate limiting between batch API calls (could trigger 429 from providers)
- [ ] MEDIUM: Progress messages broadcast to all extension pages, not just progress window
- [ ] LOW: {tags} placeholder replacement uses .replace (first occurrence only)
- [ ] LOW: No user feedback when toolbar button clicked without provider configured

## UX

- [ ] LOW: No folder exclusion (Sent, Drafts still get classified if user triggers manually)
- [ ] LOW: No indication of API cost before classifying large folders
