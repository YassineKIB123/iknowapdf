// iknowapdf.lol Worker. Static files are served by Workers static assets (wrangler.jsonc).
// This script only runs for /rx/* (assets.run_worker_first): a same-domain proxy for PostHog,
// so ad blockers that block *.posthog.com don't drop analytics. Same code as msgsaver-web/_worker.js.
const PREFIX = '/rx';
const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';

async function proxyPostHog(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length) || '/';
  const isAsset = path.startsWith('/static/') || path.startsWith('/array/');
  const target = 'https://' + (isAsset ? ASSET_HOST : API_HOST) + path + url.search;

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('host');
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip); // keeps visitor geolocation right

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  if (isAsset) init.cf = { cacheEverything: true, cacheTtl: 3600 };

  const res = await fetch(target, init);
  const out = new Response(res.body, res);
  out.headers.delete('set-cookie');
  return out;
}

const worker = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === PREFIX || pathname.startsWith(PREFIX + '/')) return proxyPostHog(request);
    return env.ASSETS.fetch(request);
  },
};

export default worker;
