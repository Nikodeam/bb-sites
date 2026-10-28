/* @meta
{
  "name": "twitter/xchat",
  "description": "List & read X (Twitter) DMs in the NEW encrypted chat UI (/i/chat). The legacy 1.1 DM API is dead for these conversations: messages arrive over an encrypted websocket and render inside shadow DOM, so this adapter uses shadow-piercing DOM extraction + SPA navigation instead of the REST API.",
  "domain": "x.com",
  "args": {
    "conversation": {"required": false, "description": "list | conversation id (g123... or userA:userB) | /i/chat/... URL | exact conversation name. NOTE: the CLI maps values to args positionally in this declaration order, so keep this arg first."},
    "mode": {"required": false, "description": "list | read (default: read)"},
    "scroll_rounds": {"required": false, "description": "Wheel-up rounds used to load older messages (default 6, max 20)"}
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
      const parts = desc.split(',').map(s => s.trim());
      let name, handle, preview, time;
      if (parts.length >= 4 && parts[1].startsWith('@')) {
        [name, handle] = parts;
        time = parts[parts.length - 1];
        preview = parts.slice(2, parts.length - 1).join(', ');
      } else if (parts.length >= 3) {
        name = parts[0];
        time = parts[parts.length - 1];
        preview = parts.slice(1, parts.length - 1).join(', ');
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
  const a1 = String(args.conversation ?? '').trim();
  const a2 = String(args.mode ?? '').trim();
  const a3 = String(args.scroll_rounds ?? '').trim();
  let mode = 'read', target = '', rounds = '';
  if (isMode(a1)) { mode = a1.toLowerCase(); target = isMode(a2) ? '' : a2; rounds = a3; }
  else { target = a1 || String(args.conv || args.id || args.name || '').trim(); if (isMode(a2)) { mode = a2.toLowerCase(); rounds = a3; } else { rounds = a2 || a3; } }
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
  const wheelRounds = Math.min(parseInt(rounds) || 6, 20);
  const scroller = byId.get('dm-message-scroller');
  if (scroller) {
    for (let i = 0; i < wheelRounds && Date.now() - t0 < 15000; i++) {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -3000 }));
      await sleep(400);
    }
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(300);
    scan();
  }

  // ── extraction ───────────────────────────────────────────────────────
  // Sender: own bubbles use bg-chat-accent (+ items-end wrapper); incoming
  // messages use bg-secondary (+ items-start wrapper, avatar on first of group).
  const messages = [];
  for (const [tid, el] of byId) {
    if (!tid.startsWith('message-text-')) continue;
    const bubble = el.closest('[class*="rounded-chat"]');
    const cls = bubble ? bubble.className : '';
    let text = el.textContent || '';
    let time;
    const tm = text.match(/(.*?)(\d{1,2}:\d{2}(?:\s?[AP]M)?)\2\s*$/s);
    if (tm) { text = tm[1]; time = tm[2]; }
    text = text.trim();
    let attachment;
    if (bubble) {
      const media = [...bubble.querySelectorAll('img,video')].filter(i => !/profile_images/.test(i.src || ''));
      if (media.length) attachment = media.map(m => m.tagName.toLowerCase()).join(',');
    }
    messages.push({ request_id: tid.replace('message-text-', ''), text, sender: cls.includes('bg-chat-accent') ? 'self' : 'other', time: time || undefined, attachment });
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
