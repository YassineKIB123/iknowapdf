"use client";

import { ToolSuccessAlert } from "@/components/common/ToolSuccessAlert";

import React, { useState, useEffect, useRef } from "react";
import { ToolLayout } from "@/components/tools/ToolLayout";
import { FileDropzone } from "@/components/tools/FileDropzone";
import { downloadBlob, loadPdfJs } from "@/lib/pdf/pdf-utils";
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Download,
  FileOutput,
  FileText,
  GripVertical,
  Loader2,
  AlertCircle,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";

interface PageThumbnail {
  /** 0-based index of the page in the uploaded file. */
  sourceIndex: number;
  objectUrl: string;
}

/** Move the item at `from` so it ends up at position `to`. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function OrganizePdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [thumbnails, setThumbnails] = useState<PageThumbnail[]>([]);
  /** Current page order, as source indices. Deleted pages are not in this list. */
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const [progressText, setProgressText] = useState("");
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const thumbnailsRef = useRef<PageThumbnail[]>([]);
  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);
  useEffect(() => {
    return () => thumbnailsRef.current.forEach((t) => URL.revokeObjectURL(t.objectUrl));
  }, []);

  const pageCount = thumbnails.length;
  const isChanged =
    order.length !== pageCount || order.some((sourceIndex, position) => sourceIndex !== position);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleFileSelected = async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;

    thumbnails.forEach((t) => URL.revokeObjectURL(t.objectUrl));
    setThumbnails([]);
    setOrder([]);
    setSelected(new Set());
    resetMessages();
    setIsLoadingDoc(true);
    setFile(picked);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdf: any = null;
    const canvas = document.createElement("canvas");
    const loaded: PageThumbnail[] = [];
    try {
      const pdfjs = await loadPdfJs();
      const data = await picked.arrayBuffer();
      pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

      for (let i = 1; i <= pdf.numPages; i++) {
        setProgressText(`Rendering page ${i} of ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.4 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), "image/jpeg", 0.72)
        );
        if (blob) loaded.push({ sourceIndex: i - 1, objectUrl: URL.createObjectURL(blob) });
      }

      if (loaded.length !== pdf.numPages) {
        throw new Error("Some pages could not be rendered. The file may be damaged.");
      }
      setThumbnails(loaded);
      setOrder(loaded.map((t) => t.sourceIndex));
    } catch (err: unknown) {
      loaded.forEach((t) => URL.revokeObjectURL(t.objectUrl));
      setErrorMessage(err instanceof Error ? err.message : "Failed to load PDF.");
      setFile(null);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (pdf && typeof pdf.destroy === "function") pdf.destroy().catch(() => {});
      setIsLoadingDoc(false);
      setProgressText("");
    }
  };

  const movePage = (from: number, to: number) => {
    resetMessages();
    setOrder((prev) => moveItem(prev, from, to));
  };

  const deletePage = (sourceIndex: number) => {
    resetMessages();
    setOrder((prev) => prev.filter((i) => i !== sourceIndex));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(sourceIndex);
      return next;
    });
  };

  const toggleSelected = (sourceIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceIndex)) next.delete(sourceIndex);
      else next.add(sourceIndex);
      return next;
    });
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    if (selected.size >= order.length) {
      setErrorMessage("A PDF needs at least one page. Keep at least one page.");
      return;
    }
    resetMessages();
    setOrder((prev) => prev.filter((i) => !selected.has(i)));
    setSelected(new Set());
  };

  const selectAll = () => setSelected(new Set(order));
  const selectNone = () => setSelected(new Set());

  const handleReset = () => {
    resetMessages();
    setOrder(thumbnails.map((t) => t.sourceIndex));
    setSelected(new Set());
  };

  const handleClear = () => {
    thumbnails.forEach((t) => URL.revokeObjectURL(t.objectUrl));
    setFile(null);
    setThumbnails([]);
    setOrder([]);
    setSelected(new Set());
    resetMessages();
  };

  /** Build a new PDF from the given source page indices, in that order. */
  const buildPdf = async (indices: number[]): Promise<Uint8Array> => {
    if (!file) throw new Error("No file loaded.");
    const { PDFDocument } = await import("pdf-lib");
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(source, indices);
    copied.forEach((page) => out.addPage(page));
    return out.save({ useObjectStreams: true });
  };

  const baseName = (file?.name ?? "document.pdf").replace(/\.pdf$/i, "");

  const handleSave = async () => {
    if (!file || order.length === 0) return;
    setIsProcessing(true);
    resetMessages();
    try {
      const bytes = await buildPdf(order);
      const name = `${baseName}_organized.pdf`;
      downloadBlob(bytes, name);
      setSuccessMessage(`Saved "${name}" with ${order.length} page${order.length === 1 ? "" : "s"}.`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save the PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExtract = async () => {
    if (!file || selected.size === 0) return;
    setIsProcessing(true);
    resetMessages();
    try {
      // Keep the on-screen order for the extracted pages.
      const indices = order.filter((i) => selected.has(i));
      const bytes = await buildPdf(indices);
      const name = `${baseName}_extracted.pdf`;
      downloadBlob(bytes, name);
      setSuccessMessage(`Extracted ${indices.length} page${indices.length === 1 ? "" : "s"} into "${name}".`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to extract pages.");
    } finally {
      setIsProcessing(false);
    }
  };

  const thumbBySource = new Map(thumbnails.map((t) => [t.sourceIndex, t]));
  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
  const iconBtn =
    "rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-white";

  return (
    <ToolLayout
      toolId="organizePdf"
      title="Organize PDF Pages"
      description="Reorder pages by dragging them, delete the pages you don't need, or pull selected pages out into a new PDF. Everything runs in your browser."
      faqs={[
        {
          question: "How do I change the order of pages in a PDF?",
          answer:
            "Upload the PDF, then drag a page thumbnail to its new position. On a phone, use the left and right arrows under each page. Click Save PDF to download the file in the new order.",
        },
        {
          question: "Can I delete pages from a PDF without uploading it?",
          answer:
            "Yes. Click the trash icon on a page, or select several pages and click Delete selected. The file is read and rebuilt in your browser with pdf-lib and is never sent to a server.",
        },
        {
          question: "How do I extract only some pages into a new PDF?",
          answer:
            "Tick the pages you want and click Extract selected. You get a new PDF with just those pages, in the order they appear on screen. The original file is not changed.",
        },
        {
          question: "Do reordered pages lose quality, links or text?",
          answer:
            "No. Pages are copied as they are, so text stays selectable and images are not re-compressed. Bookmarks are not kept in the new file, and fillable form fields may stop working.",
        },
      ]}
    >
      <div className="space-y-6">
        {!file && (
          <FileDropzone accept="application/pdf,.pdf" multiple={false} onFilesSelected={handleFileSelected} />
        )}

        {isLoadingDoc && (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-8 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
            <Loader2 className="h-5 w-5 animate-spin text-rose-600" />
            <span className="text-sm font-semibold">{progressText || "Generating page thumbnails..."}</span>
          </div>
        )}

        {!file && errorMessage && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {file && !isLoadingDoc && pageCount > 0 && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-400">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{file.name}</p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {order.length} of {pageCount} pages kept
                    {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleReset} disabled={!isChanged && selected.size === 0} className={btn}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Reset</span>
                </button>
                <button type="button" onClick={handleClear} className={btn}>
                  <X className="h-3.5 w-3.5" />
                  <span>Close file</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={selected.size === order.length ? selectNone : selectAll} className={btn}>
                {selected.size === order.length ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5 text-rose-600" />}
                <span>{selected.size === order.length ? "Select none" : "Select all"}</span>
              </button>
              <button type="button" onClick={deleteSelected} disabled={selected.size === 0} className={btn}>
                <Trash2 className="h-3.5 w-3.5 text-red-600" />
                <span>Delete selected</span>
              </button>
              <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
                Drag pages to reorder them.
              </p>
            </div>

            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {order.map((sourceIndex, position) => {
                const thumb = thumbBySource.get(sourceIndex);
                if (!thumb) return null;
                const isSelected = selected.has(sourceIndex);
                const isDropTarget = dragOver === position && dragFrom !== null && dragFrom !== position;
                return (
                  <li
                    key={sourceIndex}
                    draggable
                    onDragStart={(e) => {
                      setDragFrom(position);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(position));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOver !== position) setDragOver(position);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFrom !== null) movePage(dragFrom, position);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    className={`flex cursor-grab flex-col rounded-xl border bg-white p-3 shadow-2xs transition-all active:cursor-grabbing dark:bg-slate-950 ${
                      isSelected
                        ? "border-rose-500 ring-2 ring-rose-500/30"
                        : "border-slate-200 dark:border-slate-800"
                    } ${isDropTarget ? "scale-[1.03] border-dashed border-rose-500" : ""} ${
                      dragFrom === position ? "opacity-40" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelected(sourceIndex)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Unselect" : "Select"} page ${sourceIndex + 1}`}
                      className="relative flex h-44 w-full items-center justify-center overflow-hidden rounded bg-slate-50 p-2 dark:bg-slate-900"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb.objectUrl}
                        alt={`Page ${sourceIndex + 1}`}
                        draggable={false}
                        className="max-h-full max-w-full rounded object-contain shadow-xs"
                      />
                      <span className="absolute left-1 top-1">
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 rounded bg-white text-rose-600 dark:bg-slate-950" />
                        ) : (
                          <Square className="h-4 w-4 rounded bg-white/80 text-slate-400 dark:bg-slate-950/80" />
                        )}
                      </span>
                      <span className="absolute bottom-1 left-1 rounded bg-slate-900/90 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {position + 1}
                        {sourceIndex !== position ? ` (was ${sourceIndex + 1})` : ""}
                      </span>
                    </button>

                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-1 pt-2 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => movePage(position, position - 1)}
                        disabled={position === 0}
                        aria-label={`Move page ${sourceIndex + 1} earlier`}
                        title="Move earlier"
                        className={iconBtn}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <GripVertical className="hidden h-3.5 w-3.5 text-slate-300 sm:block dark:text-slate-600" aria-hidden />
                      <button
                        type="button"
                        onClick={() => deletePage(sourceIndex)}
                        disabled={order.length <= 1}
                        aria-label={`Delete page ${sourceIndex + 1}`}
                        title="Delete page"
                        className={`${iconBtn} hover:text-red-600`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePage(position, position + 1)}
                        disabled={position === order.length - 1}
                        aria-label={`Move page ${sourceIndex + 1} later`}
                        title="Move later"
                        className={iconBtn}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>

            {errorMessage && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && <ToolSuccessAlert message={successMessage} />}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
              <button
                type="button"
                onClick={handleExtract}
                disabled={isProcessing || selected.size === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <FileOutput className="h-4 w-4 text-rose-600" />
                <span>Extract selected{selected.size > 0 ? ` (${selected.size})` : ""}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isProcessing || order.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/20 transition-all hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>{isProcessing ? "Building PDF..." : "Save PDF"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
