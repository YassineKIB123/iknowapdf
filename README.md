# iKnowAPDF

Free PDF and image tools that run entirely in your browser. Your files are never uploaded to a server.

Live site: https://iknowapdf.lol

Most free PDF sites upload your document to their server to process it. That is a problem for contracts, IDs, medical records and bank statements. iKnowAPDF does every operation locally with WebAssembly and JavaScript, so the file stays on your device. Because the code is open, anyone can check that claim instead of trusting it.

## Tools

| Tool | Path | What it does |
| --- | --- | --- |
| Compress PDF | `/tools/compress-pdf` | Object-stream packing plus optional image downsampling, with size targets |
| Merge PDF | `/tools/merge-pdf` | Combine PDFs in any order |
| Split PDF | `/tools/split-pdf` | Pick pages visually or by range (`1-3, 5`), odd/even presets |
| Rotate PDF | `/tools/rotate-pdf` | Rotate single pages or all pages |
| Edit PDF | `/tools/edit-pdf` | Add text, images, shapes, highlights and whiteout |
| Sign PDF | `/tools/sign-pdf` | Drawn, typed or image signatures, date stamps |
| Watermark PDF | `/tools/watermark-pdf` | Text watermarks and page numbers |
| Unlock PDF | `/tools/unlock-pdf` | Remove owner restrictions with qpdf (WebAssembly) |
| Sanitize PDF | `/tools/sanitize-pdf` | Inspect and strip hidden metadata |
| Scan to PDF | `/tools/scan` | Camera capture, edge detection, perspective correction |
| Convert | `/tools/convert` | Word, Excel, PowerPoint, text and images to and from PDF |
| Images to PDF | `/tools/images-to-pdf` | JPG, PNG, WebP to PDF |
| PDF to images | `/tools/pdf-to-images` | Render pages to PNG or JPG, single files or ZIP |
| Image to text (OCR) | `/tools/image-to-text` | Tesseract OCR in the browser |
| HEIC to JPG / PDF | `/tools/heic-to-jpg`, `/tools/heic-to-pdf` | Convert iPhone photos |
| Compress image | `/tools/compress-image` | Resize and re-encode images |

## How it works

- Next.js 16 static export (`out/`), no backend for file processing.
- PDF work: [pdf-lib](https://github.com/Hopding/pdf-lib) for editing, [PDF.js](https://github.com/mozilla/pdf.js) for rendering, [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly for unlocking.
- OCR: [Tesseract](https://github.com/tesseract-ocr/tesseract) WebAssembly build, self-hosted in `public/tesseract`.
- Office formats: `mammoth`, `docx`, `xlsx`, `pptxgenjs`, `jszip`.
- Hosting: Cloudflare Workers static assets (`wrangler.jsonc`). The only Worker route is `/rx/*`, an analytics proxy.

### Check it yourself

Open DevTools, go to the Network tab, and run any tool. You will see the page load its scripts and WebAssembly files, and no request that carries your document.

### Analytics

The site uses PostHog for page views and session replays (`public/ph.js`). No cookies. On the tool pages, replays mask all text and inputs, and anything that looks like a file name. File contents are never sent. See the privacy page on the site.

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to out/
```

## Contributing

Bug reports and pull requests are welcome. Good places to start:

- A PDF that a tool fails on (attach it if it has nothing private in it, or describe its structure).
- New tools that can run fully client-side.
- Translations and accessibility fixes.

Please keep every change client-side. A pull request that sends user files to a server will not be merged.

## License

MIT. See [LICENSE](LICENSE).
