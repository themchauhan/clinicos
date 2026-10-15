import { guardOfflineApi } from "@/lib/offline/api-guard";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/offline/protocol";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };
const MAX_IDS = 10;

/**
 * Details of the existing patients a held registration might be, so staff can
 * decide "same person or not". The device keeps only their ids; the details
 * are read here, live, through the signed-in user's own session (RLS), and
 * only exist on screen.
 */
export async function GET(request: Request) {
  const guard = await guardOfflineApi(request);
  if ("response" in guard) return guard.response;

  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter(isUuid)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return Response.json({ patients: [] }, { headers: noStore });

  const supabase = await createClient();
  const { data } = await supabase
    .from("patients")
    .select("id, name, patient_code, mobile, dob, guardian_name, address")
    .in("id", ids)
    .is("deleted_at", null);
  return Response.json({ patients: data ?? [] }, { headers: noStore });
}
