/**
 * In-browser OCR with Tesseract (tesseract.js 7, LSTM-only WebAssembly builds).
 * Every file is served from /public like pdf.js and qpdf: the engine from /tesseract/<version>/,
 * language data from /tesseract/lang/4.0.0_best_int/. Nothing is sent to a server; the browser
 * caches the language data in IndexedDB after the first download.
 */
import { loadPdfJs } from "@/lib/pdf/pdf-utils";
import { decodeHeic, isHeicFile } from "@/lib/image/heic";

const TESS_BASE = "/tesseract/7.0.0";
const LANG_BASE = "/tesseract/lang/4.0.0_best_int";

export const OCR_LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "por", label: "Portuguese" },
  { code: "ita", label: "Italian" },
  { code: "rus", label: "Russian" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
  { code: "chi_sim", label: "Chinese (Simplified)" },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]["code"];

export const MAX_OCR_LANGUAGES = 3;

/** Images smaller than this on their longest side are upscaled: Tesseract misses small text. */
const MIN_LONG_SIDE = 1600;
/** Larger images are scaled down to keep memory and time reasonable on phones. */
const MAX_LONG_SIDE = 4200;
/** PDF pages without a text layer are rendered at this scale (72 dpi x 3 = 216 dpi). */
const PDF_RENDER_SCALE = 3;
/** A PDF page whose text layer has at least this many letters/digits is read directly. */
const MIN_TEXT_LAYER_CHARS = 25;

interface TesseractWorker {
  recognize: (image: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<void>;
}

interface TesseractLib {
  createWorker: (
    langs: string | string[],
    oem: number,
    options: Record<string, unknown>
  ) => Promise<TesseractWorker>;
}

declare global {
  interface Window {
    Tesseract?: TesseractLib;
  }
}

let libPromise: Promise<TesseractLib> | null = null;

function loadTesseract(): Promise<TesseractLib> {
  if (typeof window === "undefined") return Promise.reject(new Error("OCR requires a browser."));
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (libPromise) return libPromise;
  libPromise = new Promise<TesseractLib>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${TESS_BASE}/tesseract.min.js`;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else {
        libPromise = null;
        reject(new Error("The OCR engine failed to start."));
      }
    };
    script.onerror = () => {
      script.remove();
      libPromise = null;
      reject(new Error("Network error while loading the OCR engine. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return libPromise;
}

export class OcrCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "OcrCancelled";
  }
}

export type OcrProgress =
  | { stage: "loading"; progress: number }
  | { stage: "reading"; fileIndex: number; fileCount: number; page: number; pageCount: number; progress: number };

export interface OcrPageResult {
  page: number;
  text: string;
  /** "ocr" = recognized from pixels, "text-layer" = copied from the PDF's own text. */
  source: "ocr" | "text-layer";
  /** Tesseract's mean word confidence (0-100); only for source "ocr". */
  confidence?: number;
}

export interface OcrFileResult {
  name: string;
  pages: OcrPageResult[];
}

export interface OcrOptions {
  languages: OcrLanguage[];
  /** Run OCR on PDF pages even when they already contain text. */
  forceOcr?: boolean;
  onProgress?: (p: OcrProgress) => void;
  signal?: AbortSignal;
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new OcrCancelled();
}

/** Draws any image source onto a canvas, scaled so text is large enough for Tesseract. */
function toOcrCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const longSide = Math.max(width, height);
  let scale = 1;
  if (longSide < MIN_LONG_SIDE) scale = Math.min(3, MIN_LONG_SIDE / longSide);
  else if (longSide > MAX_LONG_SIDE) scale = MAX_LONG_SIDE / longSide;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't create an image canvas.");
  // White background so transparent PNG screenshots don't turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  if (isHeicFile(file)) {
    bitmap = await decodeHeic(file);
  } else {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      throw new Error(`"${file.name}" couldn't be opened as an image. Use JPG, PNG, WebP, BMP, GIF or HEIC.`);
    }
  }
  try {
    return toOcrCanvas(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** Plain text of a PDF page's own text layer, line breaks kept. */
function textFromContent(content: { items?: Array<{ str?: string; hasEOL?: boolean }> }): string {
  let out = "";
  for (const item of content.items || []) {
    if (typeof item.str === "string") out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return tidyText(out);
}

function countWordChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) || []).length;
}

/** Trims trailing spaces, collapses 3+ blank lines and removes form feeds. */
export function tidyText(text: string): string {
  return text
    .replace(/\f/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts text from images and PDFs. PDF pages that already contain selectable text are read
 * directly (exact and instant) unless `forceOcr` is set; every other page is rendered and OCR'd.
 */
export async function extractText(files: File[], opts: OcrOptions): Promise<OcrFileResult[]> {
  const { languages, forceOcr, onProgress, signal } = opts;
  if (languages.length === 0) throw new Error("Choose at least one language.");

  let worker: TesseractWorker | null = null;
  let workerPromise: Promise<TesseractWorker> | null = null;

  // Created lazily: a PDF that only has text-layer pages never downloads the engine.
  const getWorker = (): Promise<TesseractWorker> => {
    if (!workerPromise) {
      workerPromise = (async () => {
        onProgress?.({ stage: "loading", progress: 0 });
        const lib = await loadTesseract();
        const w = await lib.createWorker(languages, 1, {
          workerPath: `${TESS_BASE}/worker.min.js`,
          corePath: TESS_BASE,
          langPath: LANG_BASE,
          workerBlobURL: false,
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status && m.status !== "recognizing text" && typeof m.progress === "number") {
              onProgress?.({ stage: "loading", progress: m.progress });
            }
          },
        });
        worker = w;
        if (signal?.aborted) void w.terminate();
        return w;
      })();
    }
    return workerPromise;
  };

  // Abort = terminate the worker; the pending recognize() never settles, so race it.
  let rejectAbort: ((e: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  abortPromise.catch(() => {});
  const onAbort = () => {
    void (worker as TesseractWorker | null)?.terminate();
    rejectAbort?.(new OcrCancelled());
  };
  signal?.addEventListener("abort", onAbort);

  const ocrCanvas = async (canvas: HTMLCanvasElement): Promise<{ text: string; confidence: number }> => {
    const w = await Promise.race([getWorker(), abortPromise]);
    throwIfAborted(signal);
    const { data } = await Promise.race([w.recognize(canvas), abortPromise]);
    return { text: tidyText(data.text || ""), confidence: Math.round(data.confidence || 0) };
  };

  const results: OcrFileResult[] = [];
  try {
    for (let f = 0; f < files.length; f++) {
      throwIfAborted(signal);
      const file = files[f];
      const report = (page: number, pageCount: number, progress: number) =>
        onProgress?.({ stage: "reading", fileIndex: f, fileCount: files.length, page, pageCount, progress });

      if (isPdfFile(file)) {
        const pdfjs = await loadPdfJs();
        let pdf;
        try {
          pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
        } catch (e: unknown) {
          const name = (e as { name?: string })?.name;
          if (name === "PasswordException") {
            throw new Error(`"${file.name}" is password-protected. Remove the password with Unlock PDF first.`);
          }
          throw new Error(`"${file.name}" couldn't be read as a PDF. The file may be damaged.`);
        }
        const pages: OcrPageResult[] = [];
        try {
          for (let p = 1; p <= pdf.numPages; p++) {
            throwIfAborted(signal);
            report(p, pdf.numPages, (p - 1) / pdf.numPages);
            const page = await pdf.getPage(p);
            try {
              if (!forceOcr) {
                const layerText = textFromContent(await page.getTextContent());
                if (countWordChars(layerText) >= MIN_TEXT_LAYER_CHARS) {
                  pages.push({ page: p, text: layerText, source: "text-layer" });
                  continue;
                }
              }
              const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
              const rendered = document.createElement("canvas");
              rendered.width = Math.round(viewport.width);
              rendered.height = Math.round(viewport.height);
              const ctx = rendered.getContext("2d");
              if (!ctx) throw new Error("Your browser couldn't create an image canvas.");
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, rendered.width, rendered.height);
              await page.render({ canvasContext: ctx, viewport }).promise;
              const canvas = toOcrCanvas(rendered, rendered.width, rendered.height);
              rendered.width = rendered.height = 0;
              const { text, confidence } = await ocrCanvas(canvas);
              canvas.width = canvas.height = 0;
              pages.push({ page: p, text, source: "ocr", confidence });
            } finally {
              page.cleanup();
            }
          }
        } finally {
          void pdf.destroy();
        }
        report(pdf.numPages, pdf.numPages, 1);
        results.push({ name: file.name, pages });
      } else {
        report(1, 1, 0);
        const canvas = await imageFileToCanvas(file);
        const { text, confidence } = await ocrCanvas(canvas);
        canvas.width = canvas.height = 0;
        report(1, 1, 1);
        results.push({ name: file.name, pages: [{ page: 1, text, source: "ocr", confidence }] });
      }
    }
    return results;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Assigned inside getWorker(), which TypeScript's narrowing can't see.
    const pending = workerPromise as Promise<TesseractWorker> | null;
    if (pending) {
      try {
        const w = await Promise.race([pending, abortPromise]);
        await w.terminate();
      } catch {
        // Worker never started or was already terminated by cancel.
      }
    }
  }
}

/** Joins results into one plain-text document. Headings only when there is more than one page. */
export function resultsToText(results: OcrFileResult[]): string {
  const multiFile = results.length > 1;
  const parts: string[] = [];
  for (const r of results) {
    const multiPage = r.pages.length > 1;
    if (multiFile) parts.push(`===== ${r.name} =====`);
    for (const p of r.pages) {
      if (multiPage) parts.push(`--- Page ${p.page} ---`);
      parts.push(p.text || "[no text found]");
    }
  }
  return parts.join("\n\n");
}
