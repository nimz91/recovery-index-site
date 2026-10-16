// Host-based routing for the one Pages project that serves the whole site.
//
//   therecoveryindex.in        /         -> News (the home page)
//                              /prices/  -> Price board
//                              /news/    -> 301 to /
//   www.therecoveryindex.in    *         -> 301 to therecoveryindex.in
//   prices.therecoveryindex.in /         -> Price board (unchanged), /prices/ also works
//   newsletter.therecoveryindex.in       -> 301 to the beehiiv newsletter
//
// Everything else (assets, /data/*, /api/live, /epr/) passes straight through.

const MAIN = 'therecoveryindex.in';
const NEWSLETTER = 'https://therecoveryindex.beehiiv.com';

function asset(ctx, url, path) {
  const u = new URL(url);
  u.pathname = path;
  return ctx.env.ASSETS.fetch(new Request(u.toString(), ctx.request));
}

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const host = url.hostname;
  const path = url.pathname;

  if (host === 'www.' + MAIN) {
    url.hostname = MAIN;
    return Response.redirect(url.toString(), 301);
  }
  if (host === 'newsletter.' + MAIN) {
    return Response.redirect(NEWSLETTER + (path === '/' ? '' : path) + url.search, 301);
  }

  if (path === '/prices' || path === '/prices/index.html') {
    url.pathname = '/prices/';
    return Response.redirect(url.toString(), 301);
  }
  if (path === '/prices/') return asset(ctx, url, '/');

  if (host === MAIN) {
    if (path === '/' || path === '/index.html') return asset(ctx, url, '/news/');
    if (path === '/news' || path === '/news/' || path === '/news/index.html') {
      url.pathname = '/';
      return Response.redirect(url.toString(), 301);
    }
  }

  return ctx.next();
}
