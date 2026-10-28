# TODO — Nikodeam/bb-sites fork

Persistent issues, planned work, and known quirks. Keep entries dated.
Pull this file before starting work; append findings instead of asking twice.

## Adapter: twitter/xchat (new X chat / DMs)
Status: working — list, read, pagination, media, shared-post cards, sending (files + caption).

- [ ] **twitter/user is broken (response-shape drift)** — `UserByScreenName` GraphQL call succeeds, but the adapter reads profile fields from `data.user.result.legacy`, which X has (partially) migrated to `result.core.legacy` / `result.core`. Symptom: `{"id": "<rest_id>", "url": "https://x.com/undefined"}`. Fix = probe one live response, update JSON paths incl. `verified` (moved to verification fields). ~30 min. (2026-10-28)
- [ ] **Direct photo attachments in DMs unverified** — code path exists (`media[]` with pbs.twimg.com URLs), but no real sample observed yet; all observed media so far was shared-post video cards. If someone has a DM with a direct photo, run `bb-browser site twitter/xchat --conversation <id>` and check `msg.media`. (2026-10-28)
- [ ] **blob: media fallback** — `fetch_media` arg inlines locally-decrypted (blob:) media as base64, capped 8MB/item. Implemented but never observed in the wild — verify if X starts serving DM-native media as blob. (2026-10-28)
- [ ] **Reactions inside threads** — message reactions (e.g. "Exo reacted 💯") appear in inbox previews but are not extracted from the conversation DOM. Would need reaction-node discovery in the message container. (2026-10-28)
- [ ] **Timestamps on media-only messages** — heuristic (first clock-format match in container text) misses some; the time element may only render on hover/first-of-group. Low priority. (2026-10-28)
- [x] Media extraction: photos/videos with direct twimg URLs, shared-post cards (author, status URL, text, card media). (2026-10-28, 6bf37cf)
- [x] Sender attribution + card-bubble disambiguation. (2026-10-28, b2ec1f6 + 9f438fd)
- [x] List parsing: comma-safe names, Unread stripping, robust relative-time popping. (2026-10-28, 9f438fd)
- [x] Sending: file attachment via DataTransfer + caption + send button. (2026-10-28)

## Adapter: twitter/chat (legacy DM API)
Status: deprecated-but-guarded. The 1.1 DM endpoint no longer serves conversations that use the new X chat; the adapter detects those (g... ids / xchatEmbedRoute) and redirects to twitter/xchat. Keep it for conversations still on the legacy API, if any exist. (2026-10-28)

## Planned adapters
- [ ] **4chan** — public JSON API (a.4cdn.org), no login. Boards list, thread list per board, thread reader with reply links, image URLs from /_/ and s. Trivial. (queued 2026-10-28)
- [ ] **Polymarket** — public CLOB API + gamma API; markets, prices, order book. No login for reads. (queued 2026-10-28)
- [ ] **Telegram (custom, high value)** — no community adapter exists; TDLib userbot or web-k.telegam session automation. This is where the real circle lives. (identified 2026-10-27)

## Known quirks (bb-browser CLI / daemon)
- **Flag values map to meta args positionally** — the CLI assigns flag VALUES to @meta args in declaration order; flag names are effectively ignored. Put the most-used arg FIRST in @meta and resolve intent by inspecting values (see twitter/xchat.js arg-resolution block). (2026-10-28)
- **Daemon eval budget** — Runtime.evaluate requests time out around 10-15s. Keep adapter runtime lean; prefer single index passes over repeated full DOM walks. (2026-10-28)
- **github/* adapters broken upstream** — github/me and github/fork fail with page-level "Failed to fetch" (fetch inside GitHub's JS). Workaround used: read `meta[name=user-login]` for login state; fork via web UI. (2026-10-27)
- **New X chat renders inside shadow DOM** — plain document.querySelector cannot see it; page JS can walk OPEN shadow roots only. bb-browser snap (CDP) pierces closed roots. The xchat adapter works entirely within open-root reach. (2026-10-27)
- **X chat passcode gate** — DM section is passcode-gated (4-digit recovery). Must be entered once in the managed browser; session stays unlocked. Adapter returns a hint when the gate is detected. (2026-10-27)

## Test protocol for xchat changes
1. `node -e "const fs=require('fs');const s=fs.readFileSync('twitter/xchat.js','utf8');new Function('return ('+s.slice(s.indexOf('async function'))+')')();console.log('ok')"` — syntax as wrapped async fn (the file is an anonymous fn; `node --check` alone will fail, that is expected).
2. `bb-browser site twitter/xchat --mode list` — 13 conversations, comma-names intact, relative times popped.
3. Read a text-only thread (regression) and a media thread (media + shared_post present, direct twimg URLs).
4. `--scroll-rounds 0` must NOT coerce to default 6.
5. Commit; push to main; verify raw.githubusercontent matches local.
