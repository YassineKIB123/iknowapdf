/* PostHog analytics loader (shared by ytune.me, pinotto.vip, iknowapdf.lol, msgsaver.com).
   Loads after the page is idle so it does not affect page speed.
   No cookies (localStorage only). Replays mask every input and any text that looks like a file name.
   Skipped on localhost unless the URL has ?ph_local=1. */
(function () {
  var KEY = 'phc_mMUtSdH3zFiKQZKojsTHH5bawjsgtGzZsW8gNzhYRvNZ';
  // Sites with the same-domain proxy at /rx (a Cloudflare Worker) send everything through it,
  // so ad blockers that block *.posthog.com don't drop the data. ?ph_proxy=1 forces it (local tests).
  var PROXY = /(^|\.)(iknowapdf\.lol|msgsaver\.com)$/.test(location.hostname) || location.search.indexOf('ph_proxy=1') !== -1;
  var HOST = PROXY ? location.origin + '/rx' : 'https://us.i.posthog.com';
  var ASSETS = PROXY ? location.origin + '/rx' : 'https://us-assets.i.posthog.com';
  if (KEY.indexOf('phc_') !== 0) return;
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname) && location.search.indexOf('ph_local=1') === -1) return;
  var FILE_NAME = /[^\s/\\]+\.(pdf|jpe?g|png|webp|heic|heif|gif|bmp|tiff?|docx?|xlsx?|pptx?|txt|zip|mp4|mp3|m4a)\b/gi;
  // iKnowAPDF shows the user's own files: hide all page text and file previews in replays.
  var FILE_SITE = /(^|\.)iknowapdf\.lol$/.test(location.hostname) || location.search.indexOf('ph_files=1') !== -1;
  function start() {
    var s = document.createElement('script');
    s.async = true;
    s.src = ASSETS + '/static/array.js';
    s.onload = function () {
      if (!window.posthog || !window.posthog.init) return;
      window.posthog.init(KEY, {
        api_host: HOST,
        ui_host: 'https://us.posthog.com',
        defaults: '2025-11-30',
        person_profiles: 'identified_only',
        persistence: 'localStorage',
        mask_all_text: FILE_SITE,
        enable_recording_console_log: FILE_SITE ? false : undefined,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: FILE_SITE ? '*' : null,
          blockSelector: 'img[src^="data:"], img[src^="blob:"], canvas, video[src^="blob:"], iframe[src^="blob:"], object, embed',
          maskTextFn: function (text) { return text.replace(FILE_NAME, '***'); }
        }
      });
    };
    document.head.appendChild(s);
  }
  function idle() {
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 2000);
  }
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle);
})();
