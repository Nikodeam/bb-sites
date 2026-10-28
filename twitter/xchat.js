/* @meta
{
  "name": "twitter/xchat",
  "description": "List & read X (Twitter) DMs in the NEW encrypted chat UI (/i/chat), including media: photo/video attachments and shared-post (quote) cards are extracted with direct twimg URLs. The legacy 1.1 DM API is dead for these conversations: messages arrive over an encrypted websocket and render inside shadow DOM, so this adapter uses shadow-piercing DOM extraction + SPA navigation instead of the REST API.",
  "domain": "x.com",
  "args": {
    "conversation": {"required": false, "description": "list | conversation id (g123... or userA:userB) | /i/chat/... URL | exact conversation name. NOTE: the CLI maps values to args positionally in this declaration order, so keep this arg first."},
    "mode": {"required": false, "description": "list | read (default: read)"},
    "scroll_rounds": {"required": false, "description": "Wheel-up rounds used to load older messages (default 6, max 20)"},
    "fetch_media": {"required": false, "description": "For blob: (locally-decrypted) media, fetch and inline as data: URL (base64). Images and videos up to ~8MB each. Default: false (blob media reported as blob only)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site twitter/xchat --mode list  |  bb-browser site twitter/xchat Jen"
}
*/

async function(args) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();

  // The x-chat app renders inside shadow roots, so plain
  // document.querySelector cannot see it. Do ONE full walk over every open
  // shadow root and index everything we need, then work from the index.
  const byId = new Map();      // data-testid -> element (first occurrence)
  const anchors = [];          // all <a href*="/i/chat/">
  let passcodeGate = false;
  const scan = () => {
    byId.clear(); anchors.length = 0; passcodeGate = false;
    const walk = (root, d) => {
      if (d > 30) return;
      for (const el of root.querySelectorAll('*')) {
        const tid = el.getAttribute && el.getAttribute('data-testid');
        if (tid && !byId.has(tid)) byId.set(tid, el);
        if (el.tagName === 'A' && (el.getAttribute('href') || '').includes('/i/chat/')) anchors.push(el);
        if (!passcodeGate && el.children && el.children.length === 0 && el.textContent === 'Enter Passcode') passcodeGate = true;
        if (el.shadowRoot) walk(el.shadowRoot, d + 1);
      }
    };
    walk(document, 0);
  };
  scan();

  if (passcodeGate) {
    return {
      error: 'X chat is locked by a passcode',
      hint: 'X gates the DM section behind a 4-digit recovery passcode. Enter it once in the browser (session stays unlocked), or disable it under Settings > Privacy & safety > Direct messages.'
    };
  }

  // ── make sure the chat UI is mounted ─────────────────────────────────
  const chatMounted = () => [...byId.keys()].some(k => k === 'dm-inbox-panel' || k === 'dm-conversation-panel');
  if (!chatMounted()) {
    const navLink = byId.get('AppTabBar_DirectMessage_Link');
    if (!navLink) return { error: 'Chat UI not found', hint: 'Open https://x.com/i/chat in a tab first (bb-browser open https://x.com/i/chat), then retry.' };
    (navLink.closest('a') || navLink).click();
    for (let i = 0; i < 12 && !chatMounted(); i++) { await sleep(500); scan(); }
    if (!chatMounted()) return { error: 'Chat UI did not mount', hint: 'Open https://x.com/i/chat manually and retry.' };
  }

  // ── inbox list ───────────────────────────────────────────────────────
  const listConversations = () => {
    const out = [];
    for (const [tid, el] of byId) {
      if (!tid.startsWith('dm-conversation-item-')) continue;
      const id = tid.slice('dm-conversation-item-'.length);
      const a = el.tagName === 'A' ? el : el.querySelector('a');
      const href = a ? a.getAttribute('href') : null;
      const desc = el.getAttribute('aria-description') || '';
      const parts = desc.split(',').map(s => s.trim()).filter(Boolean);
      let name, handle, preview, time;
      const timeRe = /^(?:\d+[mhdw]|now|yesterday|today)$/i;
      if (parts.length >= 2 && parts[1].startsWith('@')) {
        name = parts[0];
        handle = parts[1];
        time = parts.length && timeRe.test(parts[parts.length - 1]) ? parts.pop() : undefined;
        preview = parts.slice(2).join(', ') || undefined;
      } else if (parts.length >= 1) {
        name = parts[0];
        time = parts.length > 1 && timeRe.test(parts[parts.length - 1]) ? parts.pop() : undefined;
        preview = parts.slice(1).join(', ') || undefined;
      } else {
        name = (el.textContent || '').split('\n')[0].trim();
      }
      const sel = el.getAttribute('data-selected');
      out.push({ id, url: href ? 'https://x.com' + href : undefined, name, handle: handle || undefined, preview: preview || undefined, time: time || undefined, selected: sel === 'true' || undefined });
    }
    return out;
  };

  // The CLI maps flag VALUES onto meta args positionally (declaration order),
  // so values can arrive shifted depending on how the user invoked it.
  // Resolve intent by inspecting the values themselves instead of trusting keys.
  const isMode = (v) => ['list', 'read'].includes(String(v).toLowerCase());
  const isRounds = (v) => /^\d+$/.test(String(v));
  const values = [args.conversation, args.mode, args.scroll_rounds, args.fetch_media]
    .map(v => String(v ?? '').trim())
    .filter(Boolean);
  let mode = 'read', target = '', rounds = '', fetchMedia = '';
  for (const value of values) {
    if (!target && !isMode(value) && !isRounds(value) && !/^(1|true|yes|0|false|no)$/i.test(value)) target = value;
    else if (isMode(value)) mode = value.toLowerCase();
    else if (isRounds(value) && !rounds) rounds = value;
    else if (/^(1|true|yes|0|false|no)$/i.test(value)) fetchMedia = value;
  }
  if (!target) target = String(args.conv || args.id || args.name || '').trim();
  args.fetch_media = fetchMedia || args.fetch_media;
  if (mode === 'list') {
    const conversations = listConversations();
    return { mode: 'list', count: conversations.length, conversations, note: 'Read a conversation with: bb-browser site twitter/xchat --conversation <id | url | name>' };
  }

  // ── mode: read ───────────────────────────────────────────────────────
  if (target) {
    let convId = target;
    const m = convId.match(/\/i\/chat\/([^\/?]+)/);
    if (m) convId = m[1];
    const norm = (s) => s.replace(/:/g, '-');
    convId = norm(convId);

    // already open?
    const currentPath = location.pathname;
    const alreadyOpen = currentPath.toLowerCase().includes(convId.toLowerCase());
    if (!alreadyOpen) {
      let anchor = null;
      for (const a of anchors) {
        const hrefId = norm(a.getAttribute('href').split('/i/chat/')[1] || '');
        if (hrefId === convId) { anchor = a; break; }
        const desc = a.getAttribute('aria-description') || a.textContent || '';
        if (desc.toLowerCase().startsWith(target.toLowerCase())) { anchor = a; break; }
      }
      if (!anchor) {
        return { error: 'Conversation not found: ' + target, hint: 'Use --mode list to see available conversations.', available: listConversations().slice(0, 20) };
      }
      const expectedPath = norm(anchor.getAttribute('href').split('/i/chat/')[1] || '');
      anchor.click();
      // Wait for the SPA route to actually change to the target conversation
      // (dm-message-list may still be mounted for the previous conversation).
      for (let i = 0; i < 14; i++) {
        await sleep(500);
        scan();
        if (location.pathname.toLowerCase().includes(expectedPath.toLowerCase()) && byId.has('dm-message-list')) break;
      }
      if (!location.pathname.toLowerCase().includes(expectedPath.toLowerCase())) {
        return { error: 'Navigation to conversation failed', hint: 'Open ' + anchor.getAttribute('href') + ' in the browser, then retry.', current_url: location.href };
      }
    }
  }

  const msgList = byId.get('dm-message-list');
  if (!msgList) {
    if (!target) {
      const conversations = listConversations();
      return { mode: 'list', count: conversations.length, conversations, hint: 'Pass --conversation <id | url | name> to read messages.' };
    }
    return { error: 'Message list not found', hint: 'Open the conversation in the browser first, then retry.' };
  }

  // ── pagination: wheel-up loads older messages (virtualized list) ─────
  const wheelRounds = Math.min(Number.isFinite(parseInt(rounds)) ? Math.max(0, parseInt(rounds)) : 6, 20);
  const wantBlobFetch = /^(1|true|yes)$/i.test(String(args.fetch_media || ''));
  const scroller = byId.get('dm-message-scroller');
  if (scroller) {
    for (let i = 0; i < wheelRounds && Date.now() - t0 < 15000; i++) {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -3000 }));
      await sleep(400);
    }
    // No jump-to-bottom here: jumping triggers a full re-render race with the
    // virtualized list. Extract whatever window is currently rendered — after
    // wheel-ups that is a mix of older + newest messages, deduped below.
    // Media cards (shared posts, photos, videos) hydrate later than the text
    // nodes, so give the pane a moment and rescan before extraction.
    await sleep(1500);
    scan();
    await sleep(700);
    scan();
  }

  // ── extraction ───────────────────────────────────────────────────────
  // Each message renders as a `message-<uuid>` container holding the media
  // (photos/videos render in their own containers — a media-only message has
  // NO `message-text-<uuid>`) and, when there is text, a nested
  // `message-text-<uuid>` span. Walk containers, not text nodes.
  // Sender: own bubbles use bg-chat-accent (+ items-end wrapper); incoming
  // messages use bg-secondary (+ items-start wrapper, avatar on first of group).
  const messages = [];
  const seenUuids = new Set();
  for (const [tid, el] of byId) {
    if (!tid.startsWith('message-') || tid.startsWith('message-text-')) continue;
    const uuid = tid.slice('message-'.length);
    if (seenUuids.has(uuid)) continue;
    seenUuids.add(uuid);

    // sender: own bubbles are accent-coloured. Shared-post cards also contain
    // rounded nodes, so a class-only check marks the other person's card as self.
    let sender = 'other';
    let bubble = null;
    const bubbles = el.querySelectorAll ? [...el.querySelectorAll('[class*="rounded-chat"]')] : [];
    const ownBubble = bubbles.find(b => (b.className || '').includes('bg-chat-accent') && !(b.querySelector && b.querySelector('a[href*="/status/"]')));
    if (ownBubble) { sender = 'self'; bubble = ownBubble; }
    else if (bubbles.length) bubble = bubbles[0];
    const containerText = (el.innerText || '').trim();
    if (sender !== 'self' && /^(You|Вы)\b/.test(containerText) && !/\b(You|Вы):/.test(containerText)) sender = 'self';

    // media: any non-avatar img / video inside the container. Media wrapped in
    // a status anchor belongs to a shared-post (quote) card; the rest is a
    // direct attachment on this message.
    const mediaItems = [];
    const cardMediaItems = [];
    const collectMedia = (el) => {
      if (el.tagName === 'IMG') {
        const src = el.currentSrc || el.src || '';
        if (!src || src.includes('profile_images')) return;
        const item = src.startsWith('blob:')
          ? { type: 'photo', blob: src.slice(0, 60) }
          : { type: 'photo', url: src, alt: el.alt && el.alt !== 'user avatar' ? el.alt : undefined };
        (el.closest('a[href*="/status/"]') ? cardMediaItems : mediaItems).push(item);
      } else if (el.tagName === 'VIDEO') {
        const url = el.currentSrc || el.src || '';
        if (url.startsWith('blob:')) { (el.closest('a[href*="/status/"]') ? cardMediaItems : mediaItems).push({ type: 'video', blob: url.slice(0, 60) }); return; }
        (el.closest('a[href*="/status/"]') ? cardMediaItems : mediaItems).push({
          type: 'video', url,
          duration_s: isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined
        });
      }
    };
    const walkContainer = (root, d) => {
      if (d > 30 || !root) return;
      for (const child of root.querySelectorAll('*')) { collectMedia(child); if (child.shadowRoot) walkContainer(child.shadowRoot, d + 1); }
    };
    walkContainer(el, 0);

    // text
    let text = '', time;
    const textEl = el.querySelector ? el.querySelector('[data-testid^="message-text-"]') : null;
    if (textEl) {
      text = textEl.textContent || '';
      const tm = text.match(/(.*?)(\d{1,2}:\d{2}(?:\s?[AP]M)?)\2\s*$/s);
      if (tm) { text = tm[1]; time = tm[2]; }
      text = text.trim();
    }
    if (!time) {
      // media-only (or unrendered-text) messages: pull the clock time from the
      // container text as a heuristic
      const tm2 = (el.innerText || '').match(/(\d{1,2}:\d{2}(?:\s?[AP]M)?)(?=\s|$)/);
      if (tm2) time = tm2[1];
    }

    // shared-post (quote) cards: status anchor + author profile anchor
    let sharedPost = null;
    const anchors = el.querySelectorAll ? [...el.querySelectorAll('a')].map(a => a.getAttribute('href') || '') : [];
    const statusUrl = anchors.find(h => /^https?:\/\/x\.com\/[^/]+\/status\/\d+/.test(h));
    if (statusUrl) {
      const profileUrl = anchors.find(h => /^https?:\/\/x\.com\/[^/]+$/.test(h));
      // card text = container text minus the message caption itself
      let cardText = (el.innerText || '').replace(text, '').trim().replace(/\s+/g, ' ');
      sharedPost = {
        url: statusUrl,
        author: profileUrl ? profileUrl.split('x.com/')[1].replace(/\/$/, '') : undefined,
        text: cardText || undefined,
        media: cardMediaItems.length ? cardMediaItems : undefined
      };
    }

    // optional blob fetch (locally-decrypted media)
    if (wantBlobFetch) {
      for (const mi of [...mediaItems, ...cardMediaItems]) {
        if (!mi.blob) continue;
        const isVideo = mi.type === 'video';
        const blobEl = [...(el.querySelectorAll ? el.querySelectorAll(isVideo ? 'video' : 'img') : [])].find(x => (x.currentSrc || x.src || '').startsWith('blob:'));
        if (!blobEl) continue;
        try {
          const resp = await fetch(blobEl.currentSrc || blobEl.src);
          const blob = await resp.blob();
          if (blob.size <= 8 * 1024 * 1024) {
            const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
            mi.data_url = dataUrl; mi.size = blob.size; delete mi.blob;
          } else { mi.too_large = blob.size; }
        } catch (e) { mi.fetch_error = String(e).slice(0, 80); }
      }
    }

    const msg = { request_id: uuid, text: text || undefined, sender, time: time || undefined };
    if (mediaItems.length) msg.media = mediaItems;
    if (sharedPost) msg.shared_post = sharedPost;
    const att = [];
    if (mediaItems.length) att.push(...mediaItems.map(m => m.type));
    if (cardMediaItems.length) att.push('card_media');
    if (sharedPost) att.push('shared_post');
    if (att.length) msg.attachment = att.join(',');
    messages.push(msg);
  }

  const header = byId.get('dm-conversation-header');
  const headerText = header ? (header.textContent || '').trim().split('\n')[0] : undefined;

  return {
    conversation_id: location.pathname.split('/i/chat/')[1] || undefined,
    url: location.href,
    participant: headerText ? { name: headerText } : undefined,
    encrypted: true,
    method: 'shadow-dom',
    count: messages.length,
    messages
  };
}
