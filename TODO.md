# TODO — Nikodeam/bb-sites fork

Persistent issues, planned work, and known quirks. Keep entries dated.
Pull this file before starting work; append findings instead of asking twice.
Last full revision: 2026-10-28.

## Adapter: twitter/xchat (new X chat / DMs)
Status: working — list, read, pagination, media extraction, shared-post cards, sending (files + caption).

- [ ] **twitter/user is broken (response-shape drift)** — `UserByScreenName` GraphQL succeeds but the adapter reads `data.user.result.legacy`, which X migrated toward `result.core.legacy`/`result.core`. Symptom: `{"id": "<rest_id>", "url": "https://x.com/undefined"}`. Fix = probe one live response, update JSON paths incl. `verified`. ~30 min. (2026-10-28)
- [ ] **Direct photo attachments in DMs unverified** — code path exists (`media[]`), but every observed sample so far was shared-post video cards. Run read on a chat with direct photos and check `msg.media`. (2026-10-28)
- [ ] **blob: media fallback** — `fetch_media` arg inlines locally-decrypted blob media as base64 (8MB/item). Implemented, never observed in the wild on X. (2026-10-28)
- [ ] **Reactions inside threads** — visible in inbox previews, not extracted from conversation DOM. (2026-10-28)
- [ ] Timestamps on media-only messages — heuristic misses some. Low priority. (2026-10-28)
- [x] Media extraction: photos/videos (direct twimg URLs + durations), shared-post cards (author, status URL, text, card media via `closest(a[href*=/status/])`). (2026-10-28, 6bf37cf)
- [x] Sender attribution + card-bubble disambiguation. (2026-10-28, b2ec1f6 + 9f438fd)
- [x] List parsing: comma-safe names (first innerText line), Unread stripping, robust relative-time popping. (2026-10-28, 9f438fd)
- [x] Sending: file attachment via DataTransfer + caption + send button. (2026-10-28)

## Adapter: twitter/chat (legacy DM API)
Status: deprecated-but-guarded — detects new-chat conversations and redirects to twitter/xchat. Kept for any conversations still on the legacy 1.1 API. (2026-10-28)

## Adapter: 4chan/read
Status: working — boards (77), board catalog (OPs + thumbs), full threads (greentext, quote-links, multi-file posts, webm/mp4 with direct i.4cdn.org URLs + sizes).

- **CORS origin quirk:** a.4cdn.org only allows the `boards.4chan.org` origin; the daemon's tab auto-open uses the wrong origin, so on a fresh machine run `bb-browser open https://boards.4chan.org/<board>` once. The adapter returns an actionable hint on CORS failure. (2026-10-28, dbf38d6)
- [ ] Rate limit: a.4cdn.org allows ~1 req/sec; rapid calls 429 (hint surfaced, no retry). (2026-10-28)

## Adapter: 4chan/search (desuarchive.org)
Status: working — full-text search across all indexed boards, pagination, media URLs (desu-usergeneratedcontent.xyz), thread/post deep links.

- API: `https://desuarchive.org/_/api/chan/search/?board=X&text=Q&page=N&limit=25` (JSON, CORS `*`); `meta.total_found`. (2026-10-28, ee52773)
- Positional-arg note: numeric values after the query = page; letters = board. Numeric boards (e.g. /3/) need explicit `--board 3`. (2026-10-28)
- [ ] Document desuarchive search operators (tripcode:, country:, image hashes) for users. (2026-10-28)
- [ ] Optional mode: archive thread reads via `/_/api/chan/thread/?board=X&num=T` (foolfuuka JSON) for deleted content. (2026-10-28)

## Adapter: telegram/read (web.telegram.org Web A)
Status: working — chats (rendered window), read (messages + media of the OPEN chat, scroll-up pagination), send (text, verified via composer clearing).

- **Trusted-click boundary:** opening a different chat cannot be synthesized from page JS (pointer/click/keyboard sequences rejected or racy). Orchestration: `bb-browser snap -i` → `bb-browser click @<ref>` on the chat item → run read/send. The adapter ABORTS if the open chat does not match the requested one (nothing gets typed/sent into the wrong chat). (2026-10-28)
- **Media** renders as blob: (locally-decrypted) — `fetch_media=true` inlines as base64 (8MB cap). File attachments not yet extracted. (2026-10-28)
- **Busy chats saturate the page main thread** — adapter eval can hit the daemon timeout even though the in-page action completes (a successful send clears the composer; if the daemon timed out, re-check with read). Daemon wedges self-recover via restart. (2026-10-28)
- **Search box injection unreliable** — for chats outside the rendered window, switch folders or scroll the sidebar. (2026-10-28)
- Saved Messages quirk: messages there lack the `own` class → sender shows 'other'. Cosmetic. (2026-10-28)

## Planned adapters
- [ ] **Polymarket** — public CLOB API + gamma API; markets, prices, order book. No login for reads. (deferred 2026-10-28 — after Telegram)
- [ ] **Tor .onion sites adapter** — idea stage: reach non-clearnet sites via a local Tor SOCKS proxy (localhost:9050). Scope: read-only research (mirrors, wikis, indexers). Needs a locally installed Tor daemon. (proposed 2026-10-28)

## Known quirks (bb-browser CLI / daemon)
- **Flag values map to meta args positionally** — the CLI assigns flag VALUES to @meta args in declaration order; flag names are effectively ignored. Put the most-used arg FIRST in @meta and resolve intent by inspecting values (see twitter/xchat.js and telegram/read.js arg-resolution blocks). (2026-10-28)
- **Daemon eval budget** — Runtime.evaluate requests time out around 10-15s. Keep adapters lean; single index passes over repeated DOM walks. (2026-10-28)
- **Daemon wedge recovery** — stuck evals can wedge the daemon worker; it self-recovers via restart (Chrome relaunches with the same profile; sessions persist). (2026-10-28)
- **github/* adapters broken upstream** — github/me and github/fork fail with page-level "Failed to fetch". Workarounds: read `meta[name=user-login]` for login state; fork via web UI. (2026-10-27)
- **New X chat renders inside shadow DOM** — plain querySelector cannot see it; page JS reaches open shadow roots only; bb-browser snap (CDP) pierces closed roots. (2026-10-27)
- **X chat passcode gate** — enter once in the managed browser; session persists across relaunches. Adapter returns a hint when detected. (2026-10-27)

## Test protocol (any adapter change)
1. Syntax as wrapped async fn: `node -e "const fs=require('fs');const s=fs.readFileSync('<file>','utf8');new Function('return ('+s.slice(s.indexOf('async function'))+')')();console.log('ok')"` — plain `node --check` fails on the anonymous-fn shape, that is expected.
2. `--mode list/chats` — counts + names intact.
3. Regression read on a text-only conversation AND a media-heavy one.
4. Edge args (`--scroll-rounds 0` must not coerce to default).
5. Commit → push to main → verify raw.githubusercontent matches local.
