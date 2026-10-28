/* @meta
{
  "name": "telegram/read",
  "description": "Telegram via web.telegram.org (Web A) with the owner's logged-in session — stateless browser control, no API keys. Modes: chats (list), read (messages + media of the OPEN chat), send (text into the OPEN chat). Opening a different chat needs a trusted click page JS cannot synthesize: bb-browser snap -i -> bb-browser click @<ref> on the chat item, then run read/send.",
  "domain": "web.telegram.org",
  "args": {
    "mode": {"required": false, "description": "chats | read (default) | send"},
    "text": {"required": false, "description": "send: message text"},
    "scroll_rounds": {"required": false, "description": "read: scroll-up rounds for older messages (default 4, max 20)"},
    "fetch_media": {"required": false, "description": "read: inline blob: media as base64 data URLs (8MB/item cap)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "bb-browser site telegram/read --mode chats"
}
*/

async function(args) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ── arg resolution: CLI maps flag VALUES onto meta args positionally ──
  const vals = [args.mode, args.text, args.scroll_rounds, args.fetch_media].map(v => String(v ?? '').trim()).filter(Boolean);
  const isMode = (v) => ['chats', 'read', 'send'].includes(v.toLowerCase());
  const isRounds = (v) => /^\\d+$/.test(v);
  const isBool = (v) => /^(1|true|yes|0|false|no)$/i.test(v);
  let mode = 'read', text = '', rounds = '', fetchMedia = '';
  for (const v of vals) {
    if (isMode(v) && mode === 'read') { mode = v.toLowerCase(); continue; }
    if (isRounds(v) && !rounds) { rounds = v; continue; }
    if (isBool(v) && !fetchMedia) { fetchMedia = v; continue; }
    if (!text) { text = v; continue; }
  }
  if (String(args.text ?? '').trim()) text = String(args.text).trim();
  if (isRounds(String(args.scroll_rounds ?? '').trim())) rounds = String(args.scroll_rounds).trim();
  if (isBool(String(args.fetch_media ?? '').trim())) fetchMedia = String(args.fetch_media).trim();
  const wantBlobFetch = /^(1|true|yes)$/i.test(fetchMedia);
  const wheelRounds = Math.min(Number.isFinite(parseInt(rounds)) ? Math.max(0, parseInt(rounds)) : 4, 20);

  // ── chat list ────────────────────────────────────────────────────────
  const chatItems = () => [...document.querySelectorAll('.ListItem.chat-item-clickable')]
    .filter(e => e.offsetParent)
    .map(e => {
      const title = ((e.querySelector('.title') || {}).innerText || '').trim();
      const avatar = e.querySelector('[data-peer-id]');
      const anchor = e.querySelector('a[href^="#"]');
      const peerId = (avatar && avatar.getAttribute('data-peer-id')) || (anchor ? anchor.getAttribute('href').slice(1) : null);
      const subtitle = (e.querySelector('.subtitle') || {}).innerText || undefined;
      const timeEl = e.querySelector('.LastMessageMeta, [class*="LastMessageMeta"]');
      const badgeEl = e.querySelector('[class*="ChatBadge"], [class*="unread"]');
      return {
        peer_id: peerId || undefined,
        name: title,
        type: /channel/.test(e.className) ? 'channel' : /group/.test(e.className) ? 'group' : 'private',
        preview: subtitle ? subtitle.replace(/\\s+/g, ' ').slice(0, 160) : undefined,
        time: timeEl ? timeEl.innerText : undefined,
        unread: badgeEl ? badgeEl.innerText.trim() : undefined
      };
    });

  if (mode === 'chats') {
    const chats = chatItems();
    return { mode: 'chats', count: chats.length, chats, note: 'Virtualized window — switch folders or scroll the list for more. Open a chat with a trusted click (bb-browser click) before read/send.' };
  }

  // ── open-chat identity ───────────────────────────────────────────────
  const isOpen = !!document.querySelector('.MessageList');
  if (!isOpen) {
    return {
      error: 'No chat is open',
      hint: 'Opening a chat needs a trusted click that page JS cannot synthesize. Steps: (1) bb-browser snap -i — find the chat item ref; (2) bb-browser click @<ref>; (3) re-run this adapter (read/send).'
    };
  }
  let peerId, chatName;
  const selItem = document.querySelector('.ListItem.selected [data-peer-id]') || document.querySelector('.ListItem.Chat.selected [data-peer-id]');
  if (selItem) peerId = selItem.getAttribute('data-peer-id');
  const items = chatItems();
  const match = items.find(c => c.peer_id === peerId);
  chatName = match ? match.name : undefined;

  // ── SAFETY: open chat must match the requested chat ──────────────────
  const reqCandidates = [String(args.chat ?? '').trim(), vals.find(v => !isMode(v) && !isRounds(v) && !isBool(v) && v !== text) || '']
    .filter(Boolean)
    .filter(v => !isMode(v));
  for (const requested of reqCandidates) {
    if (chatName && !chatName.toLowerCase().includes(requested.toLowerCase()) && requested.toLowerCase() !== String(peerId || '').toLowerCase()) {
      return {
        error: 'Open chat mismatch: "' + chatName + '" is open, requested "' + requested + '"',
        hint: 'Nothing was sent. Open the requested chat with a trusted click first (bb-browser snap -i, then bb-browser click @<ref>), then re-run.'
      };
    }
  }

  // ── message extraction ───────────────────────────────────────────────
  const collectMessages = async () => {
    const out = [];
    for (const m of document.querySelectorAll('.Message[id^="message-"]')) {
      const msgNo = m.id.replace('message-', '');
      const own = /\\bown\\b/.test(m.className);
      const metaEl = m.querySelector('[class*="MessageMeta"], [class*="Meta"]');
      const metaTxt = metaEl ? metaEl.innerText.trim() : '';
      const tmM = metaTxt.match(/(\\d{1,2}:\\d{2})(?!.*\\d{1,2}:\\d{2})/);
      const content = m.querySelector('.text-content') || m.querySelector('[class*="content"]');
      const senderEl = (m.closest('[id^="message-group"]') || m.parentElement || m).querySelector('[class*="sender-name"], [class*="senderName"]');
      const media = [];
      for (const im of m.querySelectorAll('img')) {
        const src = im.currentSrc || im.src || '';
        if (!src || /avatar|profile/.test(src) || src.startsWith('data:')) continue;
        media.push({ type: 'photo', src: src.slice(0, 120) });
      }
      for (const v of m.querySelectorAll('video')) {
        if (v.src) media.push({ type: 'video', src: String(v.src).slice(0, 120) });
      }
      if (wantBlobFetch) {
        for (const mi of media) {
          if (!mi.src || !mi.src.startsWith('blob:')) continue;
          try {
            const blobEl = [...m.querySelectorAll(mi.type === 'video' ? 'video' : 'img')].find(x => (x.currentSrc || x.src || '').startsWith('blob:'));
            const resp = await fetch(blobEl ? (blobEl.currentSrc || blobEl.src) : mi.src);
            const blob = await resp.blob();
            if (blob.size <= 8 * 1024 * 1024) {
              const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
              mi.data_url = dataUrl; mi.size = blob.size; mi.src = 'inline';
            } else { mi.too_large = blob.size; }
          } catch (e) { mi.fetch_error = String(e).slice(0, 80); }
        }
      }
      const replyEl = m.querySelector('[class*="Reply"]');
      out.push({
        msg_id: Number(msgNo),
        sender: own ? 'self' : ((senderEl && senderEl.innerText.trim()) || 'other'),
        time: (tmM ? tmM[1] : metaTxt) || undefined,
        text: content ? content.innerText.trim() : undefined,
        media: media.length ? media : undefined,
        reply_preview: replyEl ? (replyEl.innerText || '').replace(/\\n/g, ' ').slice(0, 120) : undefined
      });
    }
    out.sort((a, b) => a.msg_id - b.msg_id);
    return out;
  };

  // ── send ─────────────────────────────────────────────────────────────
  if (mode === 'send') {
    if (!text) return { error: 'Missing text for mode=send', hint: 'bb-browser site telegram/read --mode send --text "message" (chat must be open)' };
    const ed = document.querySelector('[class*="Composer"] [contenteditable=true]');
    if (!ed) return { error: 'Composer not found', hint: 'The chat may still be loading — retry.' };
    ed.focus();
    await sleep(300);
    document.execCommand('insertText', false, text);
    await sleep(900);
    // the mic/send toggle button transforms into Send when text is present
    const sendBtn = [...document.querySelectorAll('[class*="Composer"] button')].find(b => b.offsetParent && (b.className || '').includes('main-button'));
    let via;
    if (sendBtn) { sendBtn.click(); via = 'main-button'; }
    else { ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); via = 'enter'; }
    await sleep(2000);
    // cheap sent-signal: a successful send clears the composer
    const cleared = !((ed.innerText || ed.textContent || '').trim());
    let last_message;
    if (!cleared) {
      try { const all = await collectMessages(); last_message = all.slice(-1)[0]; } catch (e) {}
    }
    return { mode: 'send', chat: chatName || peerId, peer_id: peerId, via, sent: cleared, note: cleared ? undefined : 'Composer not cleared — verify with read. (Daemon eval timeouts do not abort the in-page send.)', last_message };
    
  }

  // ── read ─────────────────────────────────────────────────────────────
  const container = document.querySelector('[class*="messages-container"]') || document.querySelector('.MessageList');
  if (container && wheelRounds > 0) {
    for (let i = 0; i < wheelRounds; i++) {
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(700);
    }
    await sleep(600);
  }
  const messages = await collectMessages();
  return {
    mode: 'read',
    chat: chatName || peerId,
    peer_id: peerId,
    count: messages.length,
    messages,
    note: wheelRounds > 0 ? 'Covers the loaded history window; media src may be blob: (use fetch_media to inline).' : undefined
  };
}
