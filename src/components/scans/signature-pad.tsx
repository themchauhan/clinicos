"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/spinner";

/**
 * Plain canvas + pointer events -- works for touch and mouse alike,
 * no extra dependency needed for a hospital-signage-style signature
 * capture.
 */
export function SignaturePad({
  declarationText,
  busy,
  onSubmit,
}: {
  declarationText: string | null;
  busy: boolean;
  onSubmit: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#000000";
    }
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    hasStroke.current = true;
    const ctx = e.currentTarget.getContext("2d");
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const { x, y } = pos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  }

  function handlePointerUp() {
    drawing.current = false;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke.current = false;
  }

  function handleSubmit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke.current) return;
    onSubmit(canvas.toDataURL("image/png"));
  }

  return (
    <div className="flex flex-col gap-3">
      {declarationText ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{declarationText}</p>
      ) : null}
      <canvas
        ref={canvasRef}
        style={{ height: 200 }}
        className="w-full touch-none rounded-md border border-zinc-300 bg-white dark:border-zinc-700"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Submitting…" : "Submit signature"}
        </button>
      </div>
    </div>
  );
}
