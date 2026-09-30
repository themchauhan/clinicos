"use client";

import { useState } from "react";
import { Spinner } from "@/components/spinner";

// Just long enough to debounce an accidental double-click while the
// iframe is loading -- NOT tied to the print dialog's own lifecycle.
// A real print dialog can stay open for as long as someone takes to
// pick a printer or adjust options, and not every browser reliably
// fires `afterprint` on a nested iframe's own window either, so the
// button must never depend on "the dialog closed" to re-enable --
// that's what got it stuck on "Preparing…" after Cancel before.
const BUSY_MS = 1000;

// Safety net for removing the iframe from the DOM once printing is
// done. Best-effort only: if `afterprint` doesn't fire, this just
// means an invisible, zero-size iframe lingers a bit longer -- never
// something the visible button's state depends on.
const IFRAME_CLEANUP_MS = 60_000;

/**
 * Prints the OPD slip without navigating anywhere -- loads /slip into
 * an offscreen iframe and prints only that iframe's document. This
 * replaced a plain `target="_blank"` link (opened a whole extra tab
 * to look at) and, briefly, an auto-`window.print()` on the /slip
 * page's own mount (double-fired under React Strict Mode's dev-mode
 * double-invoke of effects) -- this is the one place that calls
 * `print()` now. Clicking it again always works, any time, regardless
 * of whether an earlier print dialog is still open.
 */
export function PrintSlipButton({ visitId }: { visitId: string }) {
  const [busy, setBusy] = useState(false);

  function handlePrint() {
    if (busy) return;
    setBusy(true);
    setTimeout(() => setBusy(false), BUSY_MS);

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.src = `/dashboard/visits/${visitId}/slip`;

    let removed = false;
    function removeIframe() {
      if (removed) return;
      removed = true;
      iframe.remove();
    }

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        removeIframe();
        return;
      }
      win.addEventListener("afterprint", removeIframe, { once: true });
      win.print();
      setTimeout(removeIframe, IFRAME_CLEANUP_MS);
    };

    document.body.appendChild(iframe);
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {busy ? <Spinner /> : null}
      {busy ? "Preparing…" : "Print slip"}
    </button>
  );
}
