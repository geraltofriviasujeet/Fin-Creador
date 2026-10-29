// pdf.js for the statement import page only: imported on demand (a separate chunk, never in the
// app's shared bundle), with its worker from this app's own build. pdf.js 6 has no eval path
// (no `new Function`), so it runs under a strict script policy.
import type { PdfLib } from "./pdf-reader"

let loading: Promise<PdfLib> | null = null

export function loadPdfjs(): Promise<PdfLib> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerPort ??= new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" })
    return lib as unknown as PdfLib
  })
  return loading
}
