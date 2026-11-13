# iKnowAPDF (iknowapdf.lol)

Global rules live in `~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md`. This file covers only this project. Keep CLAUDE.md and AGENTS.md in this folder identical.

Free, 100% in-browser PDF and image tools. Next.js 16 static export (`out/`) served as Cloudflare Workers static assets (`wrangler.jsonc`, worker `pdftool`). Priority is traffic, not revenue.

## Danger: read first
- **Pushing to `main` deploys the live site** (Cloudflare Workers Builds auto-deploys main). Work on a branch. Merge or push to main only when Yassine says to deploy.
- Never edit `out/` (build output). Source is in `src/`, `public/` and `scripts/`.
- Every file operation must stay client-side. Never add a server upload.

## Commands
- `npm run dev`: local dev server.
- `npm run build`: builds articles, runs `next build`, then `scripts/postbuild-seo.mjs` (generates the sitemap from the built HTML, fixes `<html lang>`, prints a validation report). Read the report and fix any errors.
- `npm run seo:check`: the SEO report without writing files.
- `npm run lint`.
- After a deploy: `npm run ping:indexnow`.

## Where things are
- Tools: `src/app/tools/<tool>/`. Programmatic SEO data: `src/lib/pseo/`. Exam/visa "requirement" pages: `src/lib/pseo/requirements-data.ts` (specs change every exam season, recheck NEET/SSC/CUET/IBPS before relying on them).
- `public/_redirects`: about 285 301s from the Nov 2026 pruning (441 thin pages cut to about 198). Don't recreate pruned pages.
- Locale hubs: `/fr /es /ru /ar`. Hub page: `/pdf-tools`.

## Decisions and state (don't re-propose)
- No fake `aggregateRating` or made-up review numbers.
- Exact-KB compression (image and PDF) and its landing pages already exist.
- Done on 2026-11-05: scanner upgrade, `/tools/unlock-pdf` (qpdf WASM), `/tools/heic-to-jpg`, `/tools/heic-to-pdf`.
- Done on 2026-11-13: `/tools/image-to-text` (OCR). tesseract.js 7 + LSTM-only cores self-hosted in `public/tesseract/7.0.0/`, 10 languages (`public/tesseract/lang/4.0.0_best_int/*.traineddata.gz`), loaded by `src/lib/ocr/ocr.ts`. Not an npm dependency: to upgrade, copy `dist/tesseract.min.js`, `dist/worker.min.js` and the three `*-lstm.wasm.js` cores into a new version folder and bump `TESS_BASE`. PDF pages with a text layer are copied, not OCR'd. Output is plain text only (no searchable PDF yet).
- Ideas not built yet: Protect PDF, delete/extract/reorder pages, searchable PDF (OCR text layer).
- Open issues: "$5/month" pricing is really a one-time PayPal payment with no expiry, and the `?payment=completed` unlock isn't verified. Banner ads need `NEXT_PUBLIC_ADSENSE_SLOT_ID`. Yassine is fine with the ad-free bypass for now.
- Backlinks (GitHub + Show HN, AlternativeTo, Product Hunt) are pending; ask before posting anywhere.

## Tool rules (from the 2026-11-13 review)
- pdf-lib can't decrypt. `FileDropzone` runs every PDF through `ensureUnlockedPdf` (`src/lib/pdf/pdf-utils.ts`): restricted files are unlocked with qpdf, files that need a password are refused. Only Unlock PDF passes `skipPdfUnlock`. Don't load user PDFs another way.
- Pages can have `/Rotate`. To draw on a page where the user sees it, use `getVisualPageSize` and `visualToPagePoint` (same file), not `page.getSize()` alone.
- Images to PDF never crops (A4 with no margin fits the whole image). JPEGs with EXIF rotation go through the canvas path.
- The PDF editor still exports any changed page as an image (text not selectable). Known limit, not fixed.
- `src/components/common/ContactForm.tsx` is not used anywhere; the contact page is a mailto link.

## Analytics (PostHog, added 2026-11-12)
- `ph.js` (served at `/ph.js`, loaded with `defer` in every page head) loads PostHog US Cloud after the page is idle. One PostHog project covers ytune.me, pinotto.vip and iknowapdf.lol (filter by `$host`). The same `ph.js` is in all three sites: change one, copy it to the other two.
- No cookies (localStorage only). Replays mask all inputs, file names, data:/blob: images, canvas and embeds; on iknowapdf.lol they also mask all page text. Skipped on localhost unless the URL has `?ph_local=1`. Headless browsers are dropped as bots.
- Ad-blocker proxy (2026-11-13): on iknowapdf.lol and msgsaver.com, `ph.js` sends everything to `/rx/*` on the same domain. `worker/index.js` (wrangler.jsonc `main`, `assets.run_worker_first: ["/rx/*"]`) forwards `/rx/static/*` and `/rx/array/*` to us-assets.i.posthog.com and the rest to us.i.posthog.com, with the visitor IP in X-Forwarded-For. Every other request is a plain static asset. ytune.me and pinotto.vip use the same proxy as a Pages Function (`functions/rx/[[path]].js`) since 2026-11-13. Local test: `npx wrangler dev` after `npm run build`, open `/?ph_local=1&ph_proxy=1`.
- Recorder rename (2026-11-13): EasyPrivacy (Brave, uBlock) blocks `/posthog-recorder.js` on every domain, so replays stayed at `lazy_loading`. The worker rewrites `"script":"posthog-recorder"` to `lib-rr` in `/rx/array/*/config(.js)` and `/rx/flags`, and maps `/rx/static/[<ver>/]lib-rr.js` back to the real file. Keep this in msgsaver-web/_worker.js too (same code).
- The privacy page describes PostHog. Keep it in sync if the tracking changes.
