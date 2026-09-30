"use client";

/** Manual trigger for someone who navigated to this page directly
 * (e.g. a bookmarked link) rather than via PrintSlipButton, which
 * prints this same page invisibly through a hidden iframe and never
 * lands here at all. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-6 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 print:hidden"
    >
      Print
    </button>
  );
}
