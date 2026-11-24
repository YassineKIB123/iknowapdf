"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ToolLayout } from "@/components/tools/ToolLayout";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { downloadBlob } from "@/lib/pdf/pdf-utils";
import { useLanguage } from "@/context/LanguageContext";
import {
  extractText,
  isPdfFile,
  resultsToText,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGES,
  OcrCancelled,
  type OcrFileResult,
  type OcrLanguage,
  type OcrProgress,
} from "@/lib/ocr/ocr";
import { AlertCircle, Check, Copy, Download, FileText, Image as ImageIcon, Loader2, ScanText, X } from "lucide-react";

type Phase = "idle" | "ready" | "running" | "done";

const ACCEPT = "image/*,.heic,.heif,application/pdf,.pdf";

const SITE_TO_OCR_LANG: Record<string, OcrLanguage> = { FR: "fra", ES: "spa", RU: "rus", AR: "ara" };

const FAQS = [
  {
    question: "How do I extract text from an image?",
    answer:
      "Drop the image above (or paste a screenshot with Ctrl+V), pick the language of the text and click 'Extract text'. The recognized text appears in a box you can edit, copy or download as a .txt file.",
  },
  {
    question: "Can it read scanned PDFs?",
    answer:
      "Yes. Each page of the PDF is rendered as an image and read with OCR. Pages that already contain selectable text are copied directly instead, which is exact and instant. Tick 'OCR every page' if a PDF has a broken or garbled text layer.",
  },
  {
    question: "Is my file uploaded to a server?",
    answer:
      "No. Recognition runs in your browser with Tesseract, an open-source OCR engine compiled to WebAssembly. The engine and language data are downloaded from this site once and cached; your images and PDFs never leave your device.",
  },
  {
    question: "Which languages are supported?",
    answer:
      "English, Spanish, French, German, Portuguese, Italian, Russian, Arabic, Hindi and Simplified Chinese. You can select up to three at once for documents that mix languages, but choosing only the languages actually on the page gives the best accuracy.",
  },
  {
    question: "How accurate is it?",
    answer:
      "On clean printed text, such as screenshots, typed letters and book pages, it is usually very accurate. Handwriting, very small text, curved pages and low-light phone photos give weaker results. Crop the photo to the text and keep it straight, and always check names and numbers that matter.",
  },
  {
    question: "Does it work on phones?",
    answer:
      "Yes, in Chrome, Safari, Firefox and Edge. The first run downloads about 7 MB (engine plus one language). Large multi-page scans are slower on phones than on a computer.",
  },
];

function txtName(results: OcrFileResult[]): string {
  if (results.length === 1) return `${results[0].name.replace(/\.[^.]+$/, "")}_text.txt`;
  return "extracted_text.txt";
}

function progressLabel(p: OcrProgress | null): string {
  if (!p) return "Starting…";
  if (p.stage === "loading") return `Loading OCR engine… ${Math.round(p.progress * 100)}%`;
  const file = p.fileCount > 1 ? `File ${p.fileIndex + 1} of ${p.fileCount}` : "";
  const page = p.pageCount > 1 ? `page ${p.page} of ${p.pageCount}` : "";
  return ["Reading text", [file, page].filter(Boolean).join(", ")].filter(Boolean).join(": ") + "…";
}

function progressPercent(p: OcrProgress | null): number {
  if (!p) return 0;
  if (p.stage === "loading") return Math.round(p.progress * 15);
  const perFile = 1 / p.fileCount;
  return Math.round(15 + 85 * (p.fileIndex * perFile + p.progress * perFile));
}

export default function ImageToTextPage() {
  const { language } = useLanguage();
  const [files, setFiles] = useState<File[]>([]);
  const [languages, setLanguages] = useState<OcrLanguage[]>(["eng"]);
  const [forceOcr, setForceOcr] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [results, setResults] = useState<OcrFileResult[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const langTouched = useRef(false);

  // Pre-select the language of the site locale (e.g. French on /fr pages), once.
  useEffect(() => {
    const extra = SITE_TO_OCR_LANG[language];
    if (extra && !langTouched.current) setLanguages(["eng", extra]);
  }, [language]);

  const addFiles = (incoming: File[]) => {
    if (phase === "running" || incoming.length === 0) return;
    setError(null);
    setFiles((prev) => (phase === "done" ? incoming : [...prev, ...incoming]));
    if (phase === "done") {
      setResults(null);
      setText("");
    }
    setPhase("ready");
  };

  // Paste a screenshot or copied image anywhere on the page.
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      const pasted: File[] = [];
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (!f || !(f.type.startsWith("image/") || f.type === "application/pdf")) continue;
        const ext = f.type === "application/pdf" ? "pdf" : f.type.split("/")[1] || "png";
        const name = f.name && f.name !== "image.png" ? f.name : `pasted-image-${pasted.length + 1}.${ext}`;
        pasted.push(new File([f], name, { type: f.type }));
      }
      if (pasted.length > 0) {
        e.preventDefault();
        addFilesRef.current(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const toggleLanguage = (code: OcrLanguage) => {
    langTouched.current = true;
    setError(null);
    if (languages.includes(code)) {
      if (languages.length > 1) setLanguages(languages.filter((c) => c !== code));
      return;
    }
    if (languages.length >= MAX_OCR_LANGUAGES) {
      setError(`Pick up to ${MAX_OCR_LANGUAGES} languages. Fewer languages give better accuracy.`);
      return;
    }
    setLanguages([...languages, code]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setPhase("idle");
      return next;
    });
  };

  const reset = () => {
    abortRef.current?.abort();
    setFiles([]);
    setPhase("idle");
    setProgress(null);
    setResults(null);
    setText("");
    setError(null);
    setCopied(false);
  };

  const run = async () => {
    if (files.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setError(null);
    setProgress(null);
    setCopied(false);
    try {
      const out = await extractText(files, {
        languages,
        forceOcr,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      setResults(out);
      setText(resultsToText(out));
      setPhase("done");
    } catch (err: unknown) {
      if (err instanceof OcrCancelled) {
        setPhase("ready");
        return;
      }
      setError(err instanceof Error ? err.message : "Text extraction failed. Try again.");
      setPhase("ready");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser blocked copying. Select the text and press Ctrl+C instead.");
    }
  };

  const download = () => {
    if (!results) return;
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), txtName(results));
  };

  const pageCount = results?.reduce((n, r) => n + r.pages.length, 0) ?? 0;
  const ocrPages = results?.flatMap((r) => r.pages.filter((p) => p.source === "ocr")) ?? [];
  const layerPages = pageCount - ocrPages.length;
  const avgConfidence =
    ocrPages.length > 0 ? Math.round(ocrPages.reduce((s, p) => s + (p.confidence ?? 0), 0) / ocrPages.length) : null;
  const emptyResult = phase === "done" && text.replace(/\[no text found\]|---.*---|=====.*=====/g, "").trim() === "";
  const hasPdf = files.some(isPdfFile);
  const running = phase === "running";

  return (
    <ToolLayout
      toolId="imageToText"
      title="Image to Text (OCR)"
      description="Extract text from images, screenshots, photos and scanned PDFs with OCR. Copy it or save it as .txt. Free, works in your browser, and nothing is uploaded."
      faqs={FAQS}
    >
      <div className="space-y-5">
        {phase === "idle" && (
          <FileDropzone
            accept={ACCEPT}
            multiple
            onFilesSelected={addFiles}
            title="Drop images or scanned PDFs here"
            description="JPG, PNG, WebP, HEIC or PDF. You can also paste a screenshot with Ctrl+V."
          />
        )}

        {phase !== "idle" && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {files.length} file{files.length === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={reset}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span>Start over</span>
                </button>
              </div>
              <ul className="space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {isPdfFile(f) ? (
                        <FileText className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                      ) : (
                        <ImageIcon className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
                      )}
                      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{f.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    {phase === "ready" && (
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {phase === "ready" && (
                <FileDropzone
                  accept={ACCEPT}
                  multiple
                  onFilesSelected={addFiles}
                  title="Add more files"
                  description="Or paste an image with Ctrl+V."
                />
              )}
            </div>

            {phase !== "done" && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Language of the text
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Up to {MAX_OCR_LANGUAGES}. Only pick languages that are actually in the document.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="OCR languages">
                  {OCR_LANGUAGES.map((l) => {
                    const on = languages.includes(l.code);
                    return (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => toggleLanguage(l.code)}
                        disabled={running}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          on
                            ? "border-rose-600 bg-rose-600 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-rose-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        {l.label}
                      </button>
                    );
                  })}
                </div>
                {hasPdf && (
                  <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={forceOcr}
                      onChange={(e) => setForceOcr(e.target.checked)}
                      disabled={running}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-rose-600"
                    />
                    <span>
                      OCR every page. By default, PDF pages that already have selectable text are copied directly; tick this
                      if that text comes out garbled.
                    </span>
                  </label>
                )}
              </div>
            )}

            {running && (
              <div className="space-y-2" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-rose-600" aria-hidden="true" />
                    {progressLabel(progress)}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{progressPercent(progress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-rose-600 transition-[width] duration-300"
                    style={{ width: `${progressPercent(progress)}%` }}
                  />
                </div>
                {progress?.stage === "loading" && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    The first run downloads the engine and language data (a few MB). Later runs start instantly.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <span>
                  {error}
                  {error.includes("password-protected") && (
                    <>
                      {" "}
                      <Link href="/tools/unlock-pdf" className="font-semibold underline">
                        Open Unlock PDF
                      </Link>
                    </>
                  )}
                </span>
              </div>
            )}

            {phase !== "done" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={running || files.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/20 hover:bg-rose-500 disabled:opacity-40 sm:w-auto"
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ScanText className="h-4 w-4" aria-hidden="true" />}
                  <span>{running ? "Extracting…" : "Extract text"}</span>
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={cancel}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}

            {phase === "done" && results && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    {pageCount} page{pageCount === 1 ? "" : "s"} read
                  </span>
                  {layerPages > 0 && <span>{layerPages} copied from the PDF text layer</span>}
                  {avgConfidence !== null && <span>OCR confidence: {avgConfidence}%</span>}
                </div>

                {emptyResult ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="font-semibold">No text was found.</p>
                    <p className="mt-1 text-xs">
                      Check that the right language is selected, and that the text is sharp and not too small. For phone
                      photos, crop and straighten the page with the{" "}
                      <Link href="/tools/scan" className="font-semibold underline">
                        document scanner
                      </Link>{" "}
                      first.
                    </p>
                  </div>
                ) : (
                  <>
                    {avgConfidence !== null && avgConfidence < 60 && (
                      <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        Low confidence: the image may be blurry, small or in another language. Check the text carefully.
                      </p>
                    )}
                    <label htmlFor="ocr-output" className="sr-only">
                      Extracted text
                    </label>
                    <textarea
                      id="ocr-output"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      spellCheck={false}
                      className="h-80 w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      dir="auto"
                    />
                  </>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  {!emptyResult && (
                    <>
                      <button
                        type="button"
                        onClick={() => void copy()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/20 hover:bg-rose-500"
                      >
                        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                        <span>{copied ? "Copied" : "Copy text"}</span>
                      </button>
                      <p role="status" className="sr-only">
                        {copied ? "Copied to clipboard" : ""}
                      </p>
                      <button
                        type="button"
                        onClick={download}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        <span>Download .txt</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPhase("ready")}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Change language and retry
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    New file
                  </button>
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Text recognition runs on this device. Your files are never uploaded.
            </p>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
