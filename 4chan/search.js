/* @meta
{
  "name": "4chan/search",
  "description": "Full-text search across 4chan history via desuarchive.org (public JSON API, CORS *). Returns matching posts with board, thread link, timestamp, text, and direct media URLs.",
  "domain": "boards.4chan.org",
  "args": {
    "query": {"required": true, "description": "Search text (supports desuarchive operators: text:, board:, country:, tripcode etc.)"},
    "board": {"required": false, "description": "Board filter, e.g. g, pol (omit for all indexed boards)"},
    "page": {"required": false, "description": "Result page (default 1)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site 4chan/search rust --board g"
}
*/

async function(args) {
  // CLI maps flag VALUES onto meta args positionally — classify by shape.
  const vals = [args.query, args.board, args.page].map(v => String(v ?? '').trim()).filter(Boolean);
  let query = '', board = '', page = '';
  for (const v of vals) {
    if (!query) { query = v; continue; }
    if (/^\d{1,3}$/.test(v) && page === '') { page = parseInt(v); continue; }   // numeric values after the query = page
    if (/^[a-z]{1,4}$/i.test(v) && !board) { board = v; continue; }        // letters = board code
    if (!board) { board = v; }
  }
  // explicit keys win when present
  if (String(args.query ?? '').trim()) query = String(args.query).trim();
  const eb = String(args.board ?? '').trim();
  if (eb && !/^\d+$/.test(eb)) board = eb;
  if (/^\d+$/.test(String(args.page ?? '').trim())) page = parseInt(args.page);

  if (!query) return { error: 'Missing query', hint: 'bb-browser site 4chan/search <query> [--board g]' };

  const u = new URL('https://desuarchive.org/_/api/chan/search/');
  u.searchParams.set('text', query);
  if (board) u.searchParams.set('board', board.toLowerCase());
  u.searchParams.set('page', String(parseInt(page) || 1));
  u.searchParams.set('limit', '25');

  let resp;
  try {
    resp = await fetch(u.toString(), { credentials: 'omit' });
  } catch (e) {
    return { error: 'Fetch blocked (CORS/network)', hint: 'desuarchive _/api paths allow CORS *; open any boards.4chan.org tab first so the adapter has a matching origin: bb-browser open https://boards.4chan.org/g' };
  }
  if (!resp.ok) return { error: 'HTTP ' + resp.status, hint: resp.status === 429 ? 'desuarchive rate limit — slow down' : undefined };
  const d = await resp.json();
  if (d.error) return { error: d.error, hint: 'Check query syntax' };

  const decodeEnt = (t) => (t || '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#44;/g, "'").replace(/&#39;/g, "'");
  const cleanCom = (html) => {
    if (!html) return undefined;
    let t = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<a[^>]*class="quotelink"[^>]*>(.*?)<\/a>/gs, '$1')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs, '$2 ($1)')
      .replace(/<span class="quote">(.*?)<\/span>/gs, (m, g) => '> ' + g)
      .replace(/<span class="abbr">(.*?)<\/span>/gs, '[ $1 ]')
      .replace(/<[^>]+>/g, '')
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#44;/g, "'").replace(/&#39;/g, "'")
      .replace(/&#[0-9]+;/g, '')
      .trim();
    return t || undefined;
  };

  const results = [];
  for (const [key, pageObj] of Object.entries(d)) {
    if (key === 'meta' || !pageObj || !Array.isArray(pageObj.posts)) continue;
    for (const p of pageObj.posts) {
      const media = p.media || {};
      const bobj = p.board || {};
      const item_board = typeof bobj === 'object' ? bobj.shortname : p.board;
      const item = {
        board: typeof bobj === 'object' ? (bobj.shortname || bobj.name) : p.board,
        post_no: Number(p.num),
        subnum: Number(p.subnum) || undefined,
        thread_no: Number(p.thread_num),
        thread_url: 'https://desuarchive.org/' + item_board + '/thread/' + p.thread_num + '/',
        post_url: p.subnum === '1' ? ('https://desuarchive.org/' + item_board + '/post/' + p.doc_id + '/') : ('https://desuarchive.org/' + item_board + '/thread/' + p.thread_num + '/#p' + p.num),
        name: p.name, trip: p.trip || undefined, capcode: p.capcode === 'N' ? undefined : p.capcode,
        title: decodeEnt(p.title) || undefined,
        text: cleanCom(p.comment) || undefined,
        unix_time: p.timestamp
      };
      if (media.media_link) {
        item.media = {
          url: media.media_link,
          thumb: media.thumb_link || undefined,
          filename: media.media_filename || undefined,
          w: Number(media.media_w) || undefined,
          h: Number(media.media_h) || undefined,
          size_bytes: Number(media.media_size) || undefined,
          kind: /\\.(mp4|webm)$/i.test(media.media_link) ? 'video' : 'image',
          spoiler: media.spoiler === '1' || undefined,
          deleted: media.media_status === 'banned' || media.media_status === 'deleted' ? media.media_status : undefined
        };
      }
      results.push(item);
    }
  }

  const meta = d.meta || {};
  return {
    query, board: board || 'all', page: parseInt(page) || 1,
    total_found: Number(meta.total_found) || undefined,
    results_on_page: results.length,
    results
  };
}
