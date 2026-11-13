// iknowapdf.lol Worker. Static files are served by Workers static assets (wrangler.jsonc).
// This script only runs for /rx/* (assets.run_worker_first): a same-domain proxy for PostHog,
// so ad blockers that block *.posthog.com don't drop analytics. Same code as msgsaver-web/_worker.js.
const PREFIX = '/rx';
const API_HOST = 'us.i.posthog.com';
const ASSET_HOST = 'us-assets.i.posthog.com';
// EasyPrivacy (used by Brave and uBlock) blocks "/posthog-recorder.js" on every domain, so replays never start.
// The SDK loads /static/<scriptConfig.script>.js, so the config we pass on names RECORDER_ALIAS instead,
// and /static/RECORDER_ALIAS.js is fetched from the real file upstream.
const RECORDER = 'posthog-recorder';
const RECORDER_ALIAS = 'lib-rr';
const SCRIPT_NAME = /("script"\s*:\s*")posthog-recorder"/g;

async function proxyPostHog(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length) || '/';
  const isAsset = path.startsWith('/static/') || path.startsWith('/array/');
  const upstreamPath = path.startsWith('/static/') ? path.replace('/' + RECORDER_ALIAS + '.js', '/' + RECORDER + '.js') : path;
  const target = 'https://' + (isAsset ? ASSET_HOST : API_HOST) + upstreamPath + url.search;
  const isConfig = /^\/array\/[^/]+\/config(\.js)?$/.test(path) || path.startsWith('/flags') || path.startsWith('/decide');

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('host');
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip); // keeps visitor geolocation right

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  if (isAsset) init.cf = { cacheEverything: true, cacheTtl: 3600 };

  const res = await fetch(target, init);
  if (isConfig && res.ok && request.method !== 'HEAD') {
    const body = (await res.text()).replace(SCRIPT_NAME, '$1' + RECORDER_ALIAS + '"');
    const rewritten = new Response(body, res);
    rewritten.headers.delete('content-length');
    rewritten.headers.delete('content-encoding');
    rewritten.headers.delete('set-cookie');
    return rewritten;
  }
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
