"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export async function disableMfa(): Promise<{ error?: string }> {
  // HOSPITAL_ADMIN only -- MFA is mandatory for SUPER_ADMIN (platform
  // admin), see src/lib/auth/mfa.ts, so that role can't opt back out.
  requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]);

  const supabase = await createClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    return { error: "Could not check your current two-factor status." };
  }

  const verifiedFactors = (data?.all ?? []).filter(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
  for (const factor of verifiedFactors) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      return { error: "Could not disable two-factor authentication. Try again." };
    }
  }

  revalidatePath("/account/security");
  return {};
}
