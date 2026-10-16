// On the test environment (SITE_ENV = "test", set for preview deployments in wrangler.toml):
// keep search engines out and put a visible TEST banner on every page, so a shared test link
// is never mistaken for the live site. On production this middleware passes requests straight through.
export async function onRequest({ request, env, next }) {
  const res = await next();
  if (env.SITE_ENV !== 'test') return res;
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (!(out.headers.get('Content-Type') || '').includes('text/html')) return out;
  return new HTMLRewriter().on('body', {
    element(el) {
      el.prepend(`<div role="status" style="position:sticky;top:0;z-index:50;background:#B4372F;color:#fff;font:600 13px/1.3 system-ui,sans-serif;text-align:center;padding:7px max(16px,env(safe-area-inset-left,0px))">TEST SITE · data here is for testing and is not real · nothing is sold</div>`, { html: true });
    },
  }).transform(out);
}
