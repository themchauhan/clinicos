"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/spinner";

/**
 * Renders inside a <Link>'s children -- useLinkStatus reports this
 * specific link's own in-flight navigation, so a click always gets
 * visible feedback even when the target page resolves in well under
 * a second locally (unlike on a real, network-bound deployment).
 */
export function LinkPendingSpinner({ className = "ml-1.5 inline h-3 w-3 align-[-1px]" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : null;
}
