"use client";

import { useEffect, useRef, useState } from "react";

// Loaded lazily (not at module scope) so pdfjs-dist's worker wiring
// only ever runs in the browser, never during SSR.
async function loadPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjsLib;
}

export interface PdfPageInfo {
  pageWidthPt: number;
  pageHeightPt: number;
  pageCount: number;
}

export interface PdfPoint {
  xPt: number;
  yPt: number;
}

/**
 * Renders one page of a PDF -- from a File the user just picked, or a
 * URL -- onto a canvas, and converts a click's canvas pixel into
 * PDF-point coordinates. pdf-lib (the flattening step) measures Y from
 * the *bottom* of the page; canvas/DOM clicks measure it from the
 * *top* -- this is the one place that conversion happens, so every
 * consumer of onClickAt already gets bottom-up points.
 */
export function PdfCanvas({
  source,
  pageNumber,
  onLoaded,
  onClickAt,
  children,
}: {
  source: File | string;
  pageNumber: number;
  onLoaded?: (info: PdfPageInfo) => void;
  onClickAt?: (point: PdfPoint) => void;
  /** Absolutely-positioned overlay content (field/signature markers),
   * rendered in the same pixel space as the canvas. */
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [pageHeightPt, setPageHeightPt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setError(null);
      try {
        const pdfjsLib = await loadPdfJs();
        const data = source instanceof File ? await source.arrayBuffer() : source;
        const loadingTask =
          typeof data === "string"
            ? pdfjsLib.getDocument({ url: data })
            : pdfjsLib.getDocument({ data: new Uint8Array(data) });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        const page = await doc.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });
        // Fit to a reasonable on-screen width -- the ratio between
        // this and the page's real point size is exactly the "scale"
        // used to convert clicks back to PDF points.
        const displayScale = Math.min(1, 800 / unscaledViewport.width);
        const viewport = page.getViewport({ scale: displayScale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;

        setScale(displayScale);
        setPageHeightPt(unscaledViewport.height);
        onLoaded?.({
          pageWidthPt: unscaledViewport.width,
          pageHeightPt: unscaledViewport.height,
          pageCount: doc.numPages,
        });
      } catch {
        if (!cancelled) setError("Could not render this PDF page.");
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pageNumber]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onClickAt || !scale) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    onClickAt({ xPt: canvasX / scale, yPt: pageHeightPt - canvasY / scale });
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="cursor-crosshair rounded-md border border-zinc-300 dark:border-zinc-700"
      />
      {scale ? <div className="pointer-events-none absolute inset-0">{children}</div> : null}
    </div>
  );
}

/** Converts a stored PDF-point position back into on-screen pixels
 * for an overlay marker, given the same scale/page height the canvas
 * itself just reported via onLoaded. Takes a plain {x, y} rather than
 * PdfPoint since callers pass a stored field/signature row, not a
 * fresh click. */
export function pdfPointToCanvasPixel(
  point: { x: number; y: number },
  pageInfo: PdfPageInfo,
  canvasWidthPx: number,
): { left: number; top: number } {
  const scale = canvasWidthPx / pageInfo.pageWidthPt;
  return {
    left: point.x * scale,
    top: (pageInfo.pageHeightPt - point.y) * scale,
  };
}
