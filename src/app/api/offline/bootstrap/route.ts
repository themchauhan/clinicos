import { guardOfflineApi } from "@/lib/offline/api-guard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/**
 * What the offline screens need, fetched while online: who is signed in, the
 * active visit types and doctors. Nothing about patients. When the centre's
 * offline switch is off, only `{ enabled: false }` is returned and the browser
 * tears its offline shell down.
 */
export async function GET(request: Request) {
  const guard = await guardOfflineApi(request);
  if ("response" in guard) return guard.response;
  const { profile } = guard;

  if (!profile.hospital?.offlineSyncEnabled || !profile.hospitalId) {
    return Response.json({ enabled: false }, { headers: noStore });
  }

  const supabase = await createClient();
  const [{ data: visitTypes }, { data: doctors }] = await Promise.all([
    supabase
      .from("visit_types")
      .select("id, name, default_fee, module")
      .eq("active", true)
      .order("name"),
    supabase.from("doctors").select("id, name").eq("active", true).order("name"),
  ]);

  return Response.json(
    {
      enabled: true,
      user_id: profile.userId,
      hospital_id: profile.hospitalId,
      hospital_name: profile.hospital.name,
      user_name: profile.name,
      role: profile.role,
      visit_types: (visitTypes ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        default_fee: v.default_fee,
        module: v.module,
      })),
      doctors: doctors ?? [],
    },
    { headers: noStore },
  );
}
