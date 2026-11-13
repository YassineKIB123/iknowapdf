// pdf-lib and JSZip are heavy; load them only when a conversion actually runs.
const loadPdfLib = () => import("pdf-lib");
const loadJSZip = async () => (await import("jszip")).default;
import { loadPdfJs } from "./pdf-utils";

declare global {
  interface Window {
    pdfjsLib?: any;
    XLSX?: any;
    mammoth?: any;
    docx?: any;
    PptxGenJS?: any;
  }
}

async function ensureLibrary(url: string, globalKey: string): Promise<any> {
  if (typeof window === "undefined") return null;
  if ((window as any)[globalKey]) return (window as any)[globalKey];

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if ((window as any)[globalKey]) {
        resolve((window as any)[globalKey]);
        return;
      }
      existing.remove();
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve((window as any)[globalKey]);
    script.onerror = (err) => {
      script.remove();
      reject(err);
    };
    document.body.appendChild(script);
  });
}

// Characters above U+00FF that the built-in PDF fonts (WinAnsi encoding) can still draw:
// curly quotes, dashes, bullet, ellipsis, euro, trademark and a few accented letters.
const WINANSI_EXTRA =
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";

function hasNonWinAnsiCharacters(text: string): boolean {
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0xff && !WINANSI_EXTRA.includes(ch)) return true;
  }
  return false;
}

/** Shortens `text` with "..." so it fits in `maxWidth` at the given font size. */
function fitTextToWidth(
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  text: string,
  size: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.trimEnd() + "...";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function sanitizeWinAnsiText(text: string): string {
  return text
    .replace(/\t/g, "    ")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
}

function sortPdfTextItems(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const yA = a.transform ? a.transform[5] : 0;
    const yB = b.transform ? b.transform[5] : 0;
    if (Math.abs(yA - yB) > 5) {
      return yB - yA; // Top-to-bottom (higher Y first in PDF coordinates)
    }
    const xA = a.transform ? a.transform[4] : 0;
    const xB = b.transform ? b.transform[4] : 0;
    return xA - xB; // Left-to-right
  });
}

async function unicodeTextToPDFViaCanvas(title: string, rawText: string): Promise<Uint8Array> {
  const { PDFDocument, PageSizes } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const A4_W = PageSizes.A4[0];
  const A4_H = PageSizes.A4[1];
  const SCALE = 2;
  const canvasW = Math.round(A4_W * SCALE);
  const canvasH = Math.round(A4_H * SCALE);
  const margin = 45 * SCALE;
  const maxLineW = canvasW - margin * 2;
  const lineHeight = 18 * SCALE;

  const isRTL = /[؀-ۿ]/.test(rawText);

  const measureCanvas = document.createElement("canvas");
  const mCtx = measureCanvas.getContext("2d");
  if (!mCtx) throw new Error("Canvas context unavailable for Unicode text rendering.");

  const bodyFont = `${11 * SCALE}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const boldFont = `bold ${13 * SCALE}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

  const rawLines = rawText.split(/\r?\n/);
  const wrappedLines: { text: string; isHeader: boolean }[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.trim() === "") {
      wrappedLines.push({ text: "", isHeader: false });
      continue;
    }
    const isHeader = rawLine.startsWith("# ") || rawLine.startsWith("## ");
    const cleanLine = rawLine.replace(/^#+\s*/, "");
    mCtx.font = isHeader ? boldFont : bodyFont;

    const words = cleanLine.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (mCtx.measureText(testLine).width <= maxLineW) {
        currentLine = testLine;
      } else {
        if (currentLine) wrappedLines.push({ text: currentLine, isHeader });
        currentLine = word;
      }
    }
    if (currentLine) {
      wrappedLines.push({ text: currentLine, isHeader });
    }
  }

  let lineCursor = 0;
  let pageIndex = 0;
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvasW;
  pageCanvas.height = canvasH;
  const ctx = pageCanvas.getContext("2d")!;

  while (lineCursor < wrappedLines.length || pageIndex === 0) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.direction = isRTL ? "rtl" : "ltr";
    ctx.textAlign = isRTL ? "right" : "left";
    const textX = isRTL ? canvasW - margin : margin;

    let y = margin + 20 * SCALE;

    if (pageIndex === 0 && title) {
      ctx.font = `bold ${16 * SCALE}px system-ui, sans-serif`;
      ctx.fillStyle = "#0f172a";
      ctx.fillText(title, textX, y);
      y += 28 * SCALE;
    }

    while (lineCursor < wrappedLines.length && y < canvasH - margin) {
      const item = wrappedLines[lineCursor];
      if (item.text.trim() !== "") {
        ctx.font = item.isHeader ? boldFont : bodyFont;
        ctx.fillStyle = item.isHeader ? "#0f172a" : "#1e293b";
        ctx.fillText(item.text, textX, y);
      }
      y += lineHeight;
      lineCursor++;
    }

    const blob = await new Promise<Blob | null>((res) =>
      pageCanvas.toBlob((b) => res(b), "image/jpeg", 0.92)
    );
    if (blob) {
      const bytes = await blob.arrayBuffer();
      const jpg = await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage(PageSizes.A4);
      page.drawImage(jpg, { x: 0, y: 0, width: A4_W, height: A4_H });
    }
    pageIndex++;
  }

  pageCanvas.width = 0;
  pageCanvas.height = 0;
  return await pdfDoc.save({ useObjectStreams: true });
}

// ==========================================
// 1. CONVERT TO PDF
// ==========================================

export async function textToPDF(
  file: File,
  options: { showTitle?: boolean } = {}
): Promise<Uint8Array> {
  const text = await file.text();
  const cleanTitle = options.showTitle === false ? "" : file.name.replace(/\.[^/.]+$/, "");
  const safeTitle = sanitizeWinAnsiText(cleanTitle);

  if (hasNonWinAnsiCharacters(text) || hasNonWinAnsiCharacters(cleanTitle)) {
    return await unicodeTextToPDFViaCanvas(cleanTitle, text);
  }

  const { PDFDocument, rgb, StandardFonts, PageSizes } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const fontSize = 10.5;
  const lineHeight = 15;
  const margin = 45;
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  const maxLineWidth = pageWidth - margin * 2;

  const rawLines = text.split(/\r?\n/);
  const wrappedLines: { text: string; isHeader: boolean }[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.trim() === "") {
      wrappedLines.push({ text: "", isHeader: false });
      continue;
    }

    const isHeader = rawLine.startsWith("# ") || rawLine.startsWith("## ");
    const activeFont = isHeader ? boldFont : font;
    const activeSize = isHeader ? fontSize + 2 : fontSize;
    const cleanLine = sanitizeWinAnsiText(rawLine.replace(/^#+\s*/, ""));
    const words = cleanLine.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = activeFont.widthOfTextAtSize(testLine, activeSize);

      if (testWidth <= maxLineWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) wrappedLines.push({ text: currentLine, isHeader });
        // Break single overlong tokens (such as long URLs) so they don't overflow right margin
        if (activeFont.widthOfTextAtSize(word, activeSize) > maxLineWidth) {
          let chunk = "";
          for (const ch of word) {
            if (activeFont.widthOfTextAtSize(chunk + ch, activeSize) <= maxLineWidth) {
              chunk += ch;
            } else {
              if (chunk) wrappedLines.push({ text: chunk, isHeader });
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      wrappedLines.push({ text: currentLine, isHeader });
    }
  }

  let currentPage = pdfDoc.addPage(PageSizes.A4);
  let y = pageHeight - margin;

  if (safeTitle) {
    currentPage.drawText(safeTitle, {
      x: margin,
      y,
      size: 16,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 28;
  }

  for (const line of wrappedLines) {
    if (y < margin + lineHeight) {
      currentPage = pdfDoc.addPage(PageSizes.A4);
      y = pageHeight - margin;
    }

    if (line.text.trim() !== "") {
      currentPage.drawText(line.text, {
        x: margin,
        y,
        size: line.isHeader ? fontSize + 2 : fontSize,
        font: line.isHeader ? boldFont : font,
        color: rgb(0.15, 0.15, 0.15),
      });
    }

    y -= lineHeight;
  }

  return await pdfDoc.save({ useObjectStreams: true });
}

export async function wordToPDF(file: File): Promise<Uint8Array> {
  let mammothLib = window.mammoth;
  if (!mammothLib) {
    try {
      const mod = await import("mammoth");
      mammothLib = (mod as any).default || mod;
    } catch {
      mammothLib = await ensureLibrary(
        "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
        "mammoth"
      );
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  if (typeof mammothLib.convertToHtml === "function") {
    const { value: html } = await mammothLib.convertToHtml({ arrayBuffer });
    const structuredText = html
      .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, "\n# $1\n")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "\n• $1")
      .replace(/<\/p>|<\/div>|<\/tr>|<br\s*\/?>/gi, "\n")
      .replace(/<\/td>|<\/th>/gi, "  |  ")
      .replace(/<[^>]+>/g, "");
    const cleanText = decodeHtmlEntities(structuredText)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const textFile = new File([cleanText], file.name.replace(/\.docx?$/i, ".txt"), {
      type: "text/plain",
    });
    return await textToPDF(textFile, { showTitle: false });
  }

  const { value: rawText } = await mammothLib.extractRawText({ arrayBuffer });
  const textFile = new File([rawText], file.name.replace(/\.docx?$/i, ".txt"), {
    type: "text/plain",
  });
  return await textToPDF(textFile, { showTitle: false });
}

export async function powerpointToPDF(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const [JSZip, { PDFDocument }] = await Promise.all([loadJSZip(), loadPdfLib()]);
  const zip = await JSZip.loadAsync(arrayBuffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    throw new Error("No valid PowerPoint slides were found in this file.");
  }

  // File numbers are creation order. The order the author arranged the slides in lives in
  // presentation.xml, so use that when it can be read.
  try {
    const presXml = await zip.files["ppt/presentation.xml"]?.async("text");
    const relsXml = await zip.files["ppt/_rels/presentation.xml.rels"]?.async("text");
    if (presXml && relsXml) {
      const targets = new Map<string, string>();
      for (const rel of relsXml.match(/<Relationship\b[^>]*>/g) || []) {
        const id = rel.match(/\bId="([^"]+)"/)?.[1];
        const target = rel.match(/\bTarget="([^"]+)"/)?.[1];
        if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `ppt/${target}`);
      }
      const ordered: string[] = [];
      for (const m of presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
        const path = targets.get(m[1]);
        if (path && zip.files[path]) ordered.push(path);
      }
      if (ordered.length === slideFiles.length) {
        slideFiles.splice(0, slideFiles.length, ...ordered);
      }
    }
  } catch {
    // Keep the file-number order.
  }

  const pdfDoc = await PDFDocument.create();
  const SLIDE_W = 841.89;
  const SLIDE_H = 473.56;
  const SCALE = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(SLIDE_W * SCALE);
  canvas.height = Math.round(SLIDE_H * SCALE);
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < slideFiles.length; i++) {
    const xmlContent = await zip.files[slideFiles[i]].async("text");
    const paragraphs: string[] = [];

    const pMatches = xmlContent.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) || [];
    for (const pXml of pMatches) {
      const tMatches = pXml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      const line = tMatches
        .map((t) =>
          t
            .replace(/<\/?a:t[^>]*>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
        )
        .join("");
      if (line.trim()) {
        paragraphs.push(line.trim());
      }
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(0, 0, canvas.width, 10 * SCALE);

    ctx.font = `bold ${10 * SCALE}px monospace`;
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(`SLIDE ${i + 1} / ${slideFiles.length}`, canvas.width - 36 * SCALE, canvas.height - 22 * SCALE);

    const isRTL = paragraphs.some((p) => /[؀-ۿ]/.test(p));
    ctx.direction = isRTL ? "rtl" : "ltr";
    ctx.textAlign = isRTL ? "right" : "left";
    const startX = isRTL ? canvas.width - 48 * SCALE : 48 * SCALE;
    const maxW = canvas.width - 96 * SCALE;

    let y = 58 * SCALE;
    paragraphs.forEach((para, idx) => {
      if (y > canvas.height - 45 * SCALE) return;
      const isTitle = idx === 0;
      ctx.font = isTitle
        ? `bold ${22 * SCALE}px system-ui, sans-serif`
        : `${13.5 * SCALE}px system-ui, sans-serif`;
      ctx.fillStyle = isTitle ? "#0f172a" : "#334155";

      const words = (isTitle ? para : `• ${para}`).split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width <= maxW) {
          line = test;
        } else {
          ctx.fillText(line, startX, y);
          y += (isTitle ? 28 : 20) * SCALE;
          line = word;
        }
      }
      if (line && y <= canvas.height - 40 * SCALE) {
        ctx.fillText(line, startX, y);
        y += (isTitle ? 34 : 24) * SCALE;
      }
    });

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.92)
    );
    if (blob) {
      const jpgBytes = await blob.arrayBuffer();
      const jpg = await pdfDoc.embedJpg(jpgBytes);
      const page = pdfDoc.addPage([SLIDE_W, SLIDE_H]);
      page.drawImage(jpg, { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H });
    }
  }

  canvas.width = 0;
  canvas.height = 0;
  return await pdfDoc.save({ useObjectStreams: true });
}

export async function excelToPDF(file: File): Promise<Uint8Array> {
  let xlsxLib = window.XLSX;
  if (!xlsxLib) {
    try {
      const mod = await import("xlsx");
      xlsxLib = (mod as any).default || mod;
    } catch {
      xlsxLib = await ensureLibrary(
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
        "XLSX"
      );
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  // cellDates + raw:false below give dates and numbers the way the spreadsheet shows them,
  // instead of raw serial numbers such as 46338.99.
  const workbook = xlsxLib.read(arrayBuffer, { type: "array", cellDates: true });

  let containsUnicode = false;
  for (const sheetName of workbook.SheetNames) {
    if (hasNonWinAnsiCharacters(sheetName)) containsUnicode = true;
    const rows: any[][] = xlsxLib.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
    for (const row of rows) {
      if (Array.isArray(row) && row.some((c) => c !== undefined && hasNonWinAnsiCharacters(String(c)))) {
        containsUnicode = true;
        break;
      }
    }
  }

  if (containsUnicode) {
    let textDump = "";
    for (const sheetName of workbook.SheetNames) {
      textDump += `# Sheet: ${sheetName}\n`;
      const rows: any[][] = xlsxLib.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
      for (const row of rows) {
        if (Array.isArray(row) && row.length > 0) {
          textDump += row.map((c) => (c !== undefined ? String(c) : "")).join("  |  ") + "\n";
        }
      }
      textDump += "\n";
    }
    return await unicodeTextToPDFViaCanvas(file.name.replace(/\.[^/.]+$/, ""), textDump);
  }

  const { PDFDocument, rgb, StandardFonts } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 35;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data: any[][] = xlsxLib.utils.sheet_to_json(sheet, { header: 1, raw: false });
    if (!data || data.length === 0) continue;

    let maxRowLen = 0;
    for (let i = 0; i < data.length; i++) {
      if (Array.isArray(data[i]) && data[i].length > maxRowLen) {
        maxRowLen = data[i].length;
      }
    }
    if (maxRowLen === 0) continue;

    // Wide sheets continue on further pages, 8 columns at a time, so no column is dropped.
    const COLS_PER_PAGE = 8;
    const rowHeight = 18;
    const colWidth = (pageWidth - margin * 2) / Math.min(maxRowLen, COLS_PER_PAGE);

    for (let colStart = 0; colStart < maxRowLen; colStart += COLS_PER_PAGE) {
      const cols = Math.min(COLS_PER_PAGE, maxRowLen - colStart);
      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const range = maxRowLen > COLS_PER_PAGE ? ` (columns ${colStart + 1}-${colStart + cols})` : "";
      page.drawText(`Sheet: ${sanitizeWinAnsiText(sheetName)}${range}`, {
        x: margin,
        y,
        size: 14,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 25;

      for (let rIdx = 0; rIdx < data.length; rIdx++) {
        const row = data[rIdx];
        if (!row) continue;

        if (y < margin + rowHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }

        if (rIdx === 0) {
          page.drawRectangle({
            x: margin,
            y: y - rowHeight + 12,
            width: colWidth * cols,
            height: rowHeight,
            color: rgb(0.9, 0.95, 0.92),
          });
        }

        for (let cIdx = 0; cIdx < cols; cIdx++) {
          const raw = row[colStart + cIdx];
          const cellFont = rIdx === 0 ? boldFont : font;
          const cellValue =
            raw !== undefined && raw !== null
              ? fitTextToWidth(cellFont, sanitizeWinAnsiText(String(raw)).trim(), 8.5, colWidth - 8)
              : "";
          if (cellValue) {
            page.drawText(cellValue, {
              x: margin + cIdx * colWidth + 4,
              y: y - 2,
              size: 8.5,
              font: cellFont,
              color: rIdx === 0 ? rgb(0.05, 0.3, 0.15) : rgb(0.2, 0.2, 0.2),
            });
          }
        }

        y -= rowHeight;
      }
    }
  }

  if (pdfDoc.getPageCount() === 0) {
    const emptyPage = pdfDoc.addPage([pageWidth, pageHeight]);
    emptyPage.drawText(sanitizeWinAnsiText(file.name), {
      x: margin,
      y: pageHeight - margin,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  return await pdfDoc.save({ useObjectStreams: true });
}

// ==========================================
// 2. CONVERT FROM PDF
// ==========================================

export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  let fullText = "";

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const sortedItems = sortPdfTextItems(content.items || []);
      const strings = sortedItems.map((item: any) => item.str);
      fullText += `--- Page ${i} ---\n` + strings.join(" ") + "\n\n";
    }
  } finally {
    if (typeof pdf.destroy === "function") {
      pdf.destroy().catch(() => {});
    }
  }

  return fullText;
}

export async function pdfToWord(file: File): Promise<Blob> {
  let docxLib = window.docx;
  if (!docxLib) {
    try {
      const mod = await import("docx");
      docxLib = (mod as any).default || mod;
    } catch {
      docxLib = await ensureLibrary(
        "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
        "docx"
      );
    }
  }

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxLib;
  const pdfjs = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  const docChildren: any[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      docChildren.push(
        new Paragraph({
          text: `Page ${i}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );

      const items = sortPdfTextItems(content.items || []);
      let currentY: number | null = null;
      let lineBuffer: string[] = [];

      for (const item of items) {
        if (!item.str || item.str.trim() === "") continue;

        if (currentY !== null && Math.abs(item.transform[5] - currentY) > 6) {
          docChildren.push(
            new Paragraph({
              children: [new TextRun(lineBuffer.join(" "))],
              spacing: { after: 80 },
            })
          );
          lineBuffer = [];
        }

        lineBuffer.push(item.str);
        currentY = item.transform[5];
      }

      if (lineBuffer.length > 0) {
        docChildren.push(
          new Paragraph({
            children: [new TextRun(lineBuffer.join(" "))],
            spacing: { after: 120 },
          })
        );
      }
    }
  } finally {
    if (typeof pdf.destroy === "function") {
      pdf.destroy().catch(() => {});
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: docChildren }],
  });

  return await Packer.toBlob(doc);
}

export async function pdfToExcel(file: File): Promise<Blob> {
  let xlsxLib = window.XLSX;
  if (!xlsxLib) {
    try {
      const mod = await import("xlsx");
      xlsxLib = (mod as any).default || mod;
    } catch {
      xlsxLib = await ensureLibrary(
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
        "XLSX"
      );
    }
  }

  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  const workbook = xlsxLib.utils.book_new();

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = sortPdfTextItems(content.items || []);
      const rows: string[][] = [];

      let currentY: number | null = null;
      let currentRow: string[] = [];

      for (const item of items) {
        if (!item.str || !item.str.trim()) continue;

        if (currentY !== null && Math.abs(item.transform[5] - currentY) > 6) {
          if (currentRow.length > 0) rows.push(currentRow);
          currentRow = [];
        }

        currentRow.push(item.str.trim());
        currentY = item.transform[5];
      }
      if (currentRow.length > 0) rows.push(currentRow);

      const worksheet = xlsxLib.utils.aoa_to_sheet(
        rows.length > 0 ? rows : [["No tabular text detected"]]
      );
      xlsxLib.utils.book_append_sheet(workbook, worksheet, `Page ${i}`);
    }
  } finally {
    if (typeof pdf.destroy === "function") {
      pdf.destroy().catch(() => {});
    }
  }

  const excelBuffer = xlsxLib.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function pdfToPowerPoint(file: File): Promise<Blob> {
  let PptxGen = window.PptxGenJS;
  if (!PptxGen) {
    try {
      PptxGen = (await import("pptxgenjs")).default;
    } catch {
      PptxGen = await ensureLibrary(
        "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js",
        "PptxGenJS"
      );
    }
  }

  const pdfjs = await loadPdfJs();
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  const canvas = document.createElement("canvas");

  try {
    const SLIDE_W = 13.33;
    const SLIDE_H = 7.5;
    const MAX_W = 12.5;
    const MAX_H = 6.9;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);

        // Preserve page aspect ratio centered on slide
        const pageAspect = viewport.width / Math.max(1, viewport.height);
        let drawW = MAX_W;
        let drawH = drawW / pageAspect;
        if (drawH > MAX_H) {
          drawH = MAX_H;
          drawW = drawH * pageAspect;
        }
        const drawX = (SLIDE_W - drawW) / 2;
        const drawY = (SLIDE_H - drawH) / 2;

        const slide = pptx.addSlide();
        slide.addImage({
          data: dataUrl,
          x: drawX,
          y: drawY,
          w: drawW,
          h: drawH,
        });
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (typeof pdf.destroy === "function") {
      pdf.destroy().catch(() => {});
    }
  }

  const out = await pptx.write({ outputType: "blob" });
  return out as Blob;
}
