/* @meta
{
  "name": "4chan/read",
  "description": "Read 4chan: board list, board catalog (OPs), or a full thread with replies and direct media URLs (i.4cdn.org). Uses the public a.4cdn.org JSON API (CORS-open, no login).",
  "domain": "boards.4chan.org",
  "args": {
    "mode": {"required": false, "description": "boards | catalog (default) | thread"},
    "board": {"required": false, "description": "Board code, e.g. g, pol, sci"},
    "thread": {"required": false, "description": "Thread number (for mode=thread)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site 4chan/read --mode catalog --board g"
}
*/

async function(args) {
  // CLI maps flag VALUES onto meta args positionally — classify by shape.
  const vals = [args.mode, args.board, args.thread].map(v => String(v ?? '').trim()).filter(Boolean);
  const isMode = (v) => ['boards', 'catalog', 'thread'].includes(String(v).toLowerCase());
  let mode = 'catalog', board = '', thread = '';
  for (const v of vals) {
    if (isMode(v) && !board && !thread) { mode = v.toLowerCase(); continue; }
    if (/^\d{6,}$/.test(v) && board && !thread) { thread = v; continue; }
    if (!board) { board = v; continue; }
    if (!thread && /^\d+$/.test(v)) { thread = v; continue; }
  }
  // also accept explicit keys when they survive the positional mapping
  const explicitBoard = String(args.board ?? '').trim();
  const explicitThread = String(args.thread ?? '').trim();
  if (explicitBoard && !isMode(explicitBoard)) board = explicitBoard;
  if (/^\d+$/.test(explicitThread)) thread = explicitThread;
  if (isMode(String(args.mode ?? ''))) mode = String(args.mode).toLowerCase();

  board = String(board || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (mode !== 'boards' && !board) {
    return { error: 'Missing board', hint: 'bb-browser site 4chan/read --board g  |  --mode boards lists all boards' };
  }
  if (mode === 'thread' && !thread) {
    return { error: 'Missing thread number', hint: 'Get thread numbers from mode=catalog (field: no)' };
  }

  const fetchJson = async (url) => {
    let resp;
    try {
      resp = await fetch(url, { credentials: 'omit' });
    } catch (e) {
      return { error: 'Fetch blocked (CORS/network)', hint: 'a.4cdn.org only allows the boards.4chan.org origin. Open a boards tab first: bb-browser open https://boards.4chan.org/' + (board || 'g') + ' — then retry.' };
    }
    if (!resp.ok) return { error: 'HTTP ' + resp.status + ' from ' + url, hint: resp.status === 404 ? 'Check board/thread' : (resp.status === 429 ? 'Rate limited — a.4cdn.org allows ~1 req/sec' : undefined) };
    return resp.json();
  };

  if (mode === 'boards') {
    const d = await fetchJson('https://a.4cdn.org/boards.json');
    if (d.error) return d;
    const decode = (t) => (t || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#39;/g, "'");
    return { mode: 'boards', count: d.boards.length, boards: d.boards.map(b => ({ code: b.board, title: decode(b.title), description: decode((b.meta_description || '')).slice(0, 140), threads_per_page: b.threads_per_page, max_thread_replies: b.max_replies })) };
  }

  const fileUrl = (tim, ext) => 'https://i.4cdn.org/' + board + '/' + tim + ext;
  const thumbUrl = (tim) => 'https://i.4cdn.org/' + board + '/' + tim + 's.jpg';

  const decodeEnt = (t) => (t || '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#44;/g, "'").replace(/&#39;/g, "'");

  const cleanCom = (html) => {
    if (!html) return undefined;
    let t = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<wbr>/gi, '')
      .replace(/<span class="quote">(.*?)<\/span>/gs, (m, g) => '> ' + g)
      .replace(/<a[^>]*class="quotelink"[^>]*>(.*?)<\/a>/gs, '$1')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs, '$2 ($1)')
      .replace(/<span class="abbr">(.*?)<\/span>/gs, '[ $1 ]')
      .replace(/<[^>]+>/g, '')
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#44;/g, "'").replace(/&#39;/g, "'")
      .replace(/&#[0-9]+;/g, '')
      .trim();
    return t || undefined;
  };

  const postFiles = (post) => {
    const files = [];
    if (post.tim && post.ext) {
      files.push({
        name: post.filename ? post.filename + post.ext : undefined,
        url: fileUrl(post.tim, post.ext),
        thumb: thumbUrl(post.tim),
        w: post.w, h: post.h, size_bytes: post.fsize, kind: post.ext === '.mp4' || post.ext === '.webm' ? 'video' : 'image'
      });
    }
    for (const f of post.extra_files || []) {
      if (f.tim && f.ext) files.push({ name: f.filename ? f.filename + f.ext : undefined, url: fileUrl(f.tim, f.ext), thumb: thumbUrl(f.tim), w: f.w, h: f.h, size_bytes: f.fsize, kind: f.ext === '.mp4' || f.ext === '.webm' ? 'video' : 'image' });
    }
    return files.length ? files : undefined;
  };

  if (mode === 'catalog') {
    const d = await fetchJson('https://a.4cdn.org/' + board + '/catalog.json');
    if (d.error) return d;
    const threads = [];
    for (const page of d) {
      for (const t of page.threads || []) {
        threads.push({
          no: t.no,
          title: decodeEnt(t.subjective || t.sub) || undefined,
          text: cleanCom(t.com) || undefined,
          replies: t.replies, images: t.images,
          sticky: t.sticky || undefined, archived: t.archived || undefined,
          last_modified: t.last_modified,
          files: postFiles(t)
        });
      }
    }
    return { mode: 'catalog', board, count: threads.length, threads };
  }

  if (mode === 'thread') {
    const d = await fetchJson('https://a.4cdn.org/' + board + '/thread/' + thread + '.json');
    if (d.error) return d;
    const posts = (d.posts || []).map(p => ({
      no: p.no,
      op: p.resto === 0 || undefined,
      reply_to: p.resto || undefined,
      name: p.name,
      trip: p.trip || undefined,
      capcode: p.capcode || undefined,
      text: cleanCom(p.com) || undefined,
      unix_time: p.time,
      replies: p.n_replies || undefined,
      files: postFiles(p)
    }));
    return { mode: 'thread', board, thread: Number(thread), count: posts.length, posts };
  }

  return { error: 'Unknown mode: ' + mode, hint: 'boards | catalog | thread' };
}
