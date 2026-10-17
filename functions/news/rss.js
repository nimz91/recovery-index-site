// GET /news/rss — RSS 2.0 feed of the news page, built on request from /data/news.json.
// Each item links to the story's anchor on the news page; the publisher's article is linked in the description.
// Readers, Google News-style aggregators and beehiiv's RSS-to-email can all subscribe to it.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Same anchor scheme as public/news/index.html (djb2 hash of the source URL).
function sid(u) {
  let h = 5381;
  for (let i = 0; i < u.length; i++) h = ((h << 5) + h + u.charCodeAt(i)) >>> 0;
  return 's-' + h.toString(36);
}

const rfc822 = (d) => new Date(d + 'T06:00:00+05:30').toUTCString(); // 6 am IST on the story date

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const res = await env.ASSETS.fetch(new Request(origin + '/data/news.json'));
  if (!res.ok) return new Response('News feed unavailable', { status: 503 });
  const data = await res.json();
  // On therecoveryindex.in the news page is the home page; on other hosts it lives at /news/.
  const page = origin + (new URL(request.url).hostname === 'therecoveryindex.in' ? '/' : '/news/');
  const items = (data.items || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  const body = items.map((it) => {
    const desc = `<p>${esc(it.summary)}</p><p><b>Why it matters:</b> ${esc(it.why)}</p>` +
      `<p>Source: <a href="${esc(it.url)}">${esc(it.source)}</a></p>`;
    return `<item>
<title>${esc(it.title)}</title>
<link>${esc(page + '#' + sid(it.url))}</link>
<guid isPermaLink="false">${esc(it.url)}</guid>
<pubDate>${rfc822(it.date)}</pubDate>
<category>${esc(it.region)}</category>
<category>${esc(it.topic)}</category>
<source url="${esc(it.url)}">${esc(it.source)}</source>
<description>${esc(desc)}</description>
</item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>The Recovery Index · E-waste &amp; Recycling News</title>
<link>${esc(page)}</link>
<atom:link href="${esc(origin + '/news/rss')}" rel="self" type="application/rss+xml"/>
<description>E-waste, EPR, battery and black mass recycling, rare earths and critical minerals. India first, then the world.</description>
<language>en-in</language>
<lastBuildDate>${rfc822(data.updated || items[0]?.date || '2026-01-01')}</lastBuildDate>
${body}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  });
}
