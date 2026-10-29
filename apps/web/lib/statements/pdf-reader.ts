// Reads a statement PDF's text in the browser (Sprint 9a.3). The file and its password stay in
// the browser: pdf.js works on the bytes in memory, nothing is uploaded, and the password is
// only passed to pdf.js for this one read (never kept, logged or sent). Text PDFs only, no OCR.
// pdf.js is passed in (the bundled browser module on web, the Node build in tests).
import {
  MAX_STATEMENT_PDF_BYTES,
  MAX_STATEMENT_PDF_PAGES,
  type PdfTextItem,
  statementTextFromPages,
} from "@fin-creador/domain"

/** The part of pdf.js used here. */
export type PdfLib = {
  getDocument: (src: {
    data: Uint8Array
    password?: string
    disableFontFace?: boolean
    useSystemFonts?: boolean
    enableXfa?: boolean
    isOffscreenCanvasSupported?: boolean
    verbosity?: number
  }) => {
    promise: Promise<PdfDocument>
    destroy: () => Promise<void>
  }
}

type PdfDocument = {
  numPages: number
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>
}

export type PdfReadResult =
  | { status: "ok"; text: string; pages: number }
  | { status: "needs_password" }
  | { status: "wrong_password" }
  | { status: "no_text" }
  | { status: "too_large" }
  | { status: "too_many_pages" }
  | { status: "unreadable" }

export const PDF_READ_MESSAGES: Record<Exclude<PdfReadResult["status"], "ok" | "needs_password">, string> = {
  wrong_password: "That password didn't open the PDF. Check it and try again.",
  no_text: "This looks like a scanned PDF; only text PDFs can be read.",
  too_large: `This file is over ${MAX_STATEMENT_PDF_BYTES / 1024 / 1024} MB. Choose the statement PDF from your bank.`,
  too_many_pages: `This PDF has more than ${MAX_STATEMENT_PDF_PAGES} pages. Choose a single statement.`,
  unreadable: "We couldn't read this PDF. Check that it is a statement PDF and try again.",
}

// pdf.js PasswordException codes (PasswordResponses).
const NEED_PASSWORD = 1
const INCORRECT_PASSWORD = 2

const isTextItem = (item: unknown): item is { str: string; transform: number[]; width: number; height: number } =>
  typeof item === "object" && item !== null && "str" in item && "transform" in item

/** The statement's text, one row per line (rows by y, cells by x), or why it can't be read. */
export async function readStatementPdf(lib: PdfLib, data: Uint8Array, password?: string): Promise<PdfReadResult> {
  if (data.byteLength > MAX_STATEMENT_PDF_BYTES) return { status: "too_large" }
  const task = lib.getDocument({
    // pdf.js may transfer the buffer to its worker, so it gets a copy.
    data: data.slice(),
    password: password === "" ? undefined : password,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  })
  try {
    let doc: PdfDocument
    try {
      doc = await task.promise
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") {
        const code = (error as Error & { code?: number }).code
        if (code === INCORRECT_PASSWORD) return { status: "wrong_password" }
        if (code === NEED_PASSWORD) return { status: password ? "wrong_password" : "needs_password" }
      }
      return { status: "unreadable" }
    }
    if (doc.numPages > MAX_STATEMENT_PDF_PAGES) return { status: "too_many_pages" }

    const pages: PdfTextItem[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      pages.push(
        content.items.filter(isTextItem).map((item) => ({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
          height: item.height || Math.abs(item.transform[3] ?? 0),
        })),
      )
    }
    const text = statementTextFromPages(pages)
    if (text.trim() === "") return { status: "no_text" }
    return { status: "ok", text, pages: doc.numPages }
  } catch {
    return { status: "unreadable" }
  } finally {
    await task.destroy().catch(() => undefined)
  }
}
