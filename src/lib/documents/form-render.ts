import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExtraStamp } from "@/types/database";
import type { FormFieldPlacement, StampPlacement } from "@/lib/documents/form-flatten";

type Template = Database["public"]["Tables"]["form_templates"]["Row"] & {
  form_template_fields: Database["public"]["Tables"]["form_template_fields"]["Row"][] | null;
};

export interface FlattenParts {
  fields: FormFieldPlacement[];
  seals: StampPlacement[];
  doctorSignatures: StampPlacement[];
}

/** Every box a template places for one kind of stamp: the first (stored in
 * the template's own columns) followed by any extra placements. */
export function stampBoxes(
  template: Template,
  kind: ExtraStamp["kind"],
): { page: number; x: number; y: number; width: number; height: number }[] {
  const boxes: { page: number; x: number; y: number; width: number; height: number }[] = [];
  if (kind === "SEAL" && template.seal_page) {
    boxes.push({
      page: template.seal_page,
      x: template.seal_x!,
      y: template.seal_y!,
      width: template.seal_width!,
      height: template.seal_height!,
    });
  }
  if (kind === "DOCTOR_SIGNATURE" && template.doctor_signature_page) {
    boxes.push({
      page: template.doctor_signature_page,
      x: template.doctor_signature_x!,
      y: template.doctor_signature_y!,
      width: template.doctor_signature_width!,
      height: template.doctor_signature_height!,
    });
  }
  for (const stamp of template.extra_stamps ?? []) {
    if (stamp.kind === kind) {
      boxes.push({
        page: stamp.page,
        x: stamp.x,
        y: stamp.y,
        width: stamp.width,
        height: stamp.height,
      });
    }
  }
  return boxes;
}

/**
 * Everything a filled form needs besides the blank PDF and the patient's
 * signature: the typed/ticked fields, plus the hospital seal and the
 * visit's doctor's saved signature at EVERY place the template stamps them.
 * Shared by the desk path (form-actions.ts, tenant session) and the phone
 * path (scan/actions.ts, service role) so the two can never drift apart.
 *
 * Stamps are optional and skipped quietly when there is nothing to stamp
 * (no box placed, the hospital hasn't uploaded a seal, the visit has no
 * doctor, that doctor has no saved signature) -- the same graceful skip as
 * any other unset auto-fill source. `hospitalId` is always filtered
 * explicitly so this is safe with either kind of client.
 */
export async function buildFlattenParts(
  supabase: SupabaseClient<Database>,
  template: Template,
  fieldValues: Record<string, string>,
  context: { hospitalId: string; visitId?: string | null },
): Promise<FlattenParts> {
  const fields: FormFieldPlacement[] = (template.form_template_fields ?? []).map((f) => ({
    pageNumber: f.page_number,
    x: f.x,
    y: f.y,
    fontSize: f.font_size,
    multiline: f.input_type === "textarea",
    value: fieldValues[f.field_key] ?? "",
    inputType: f.input_type,
    checklistKey: f.checklist_key,
    tickMarks: f.tick_marks ?? [],
  }));

  const sealBoxes = stampBoxes(template, "SEAL");
  const signatureBoxes = stampBoxes(template, "DOCTOR_SIGNATURE");

  const seals: StampPlacement[] = [];
  if (sealBoxes.length > 0) {
    const { data: hospitalProfile } = await supabase
      .from("hospital_form_profile")
      .select("seal_storage_path")
      .eq("hospital_id", context.hospitalId)
      .maybeSingle();
    if (hospitalProfile?.seal_storage_path) {
      const { data: file } = await supabase.storage
        .from("documents")
        .download(hospitalProfile.seal_storage_path);
      if (file) {
        const image = Buffer.from(await file.arrayBuffer());
        for (const b of sealBoxes) {
          seals.push({
            pageNumber: b.page,
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            image,
          });
        }
      }
    }
  }

  const doctorSignatures: StampPlacement[] = [];
  if (signatureBoxes.length > 0 && context.visitId) {
    const { data: visit } = await supabase
      .from("visits")
      .select("doctor_id")
      .eq("id", context.visitId)
      .eq("hospital_id", context.hospitalId)
      .maybeSingle();
    if (visit?.doctor_id) {
      const { data: doctor } = await supabase
        .from("doctors")
        .select("signature_storage_path")
        .eq("id", visit.doctor_id)
        .eq("hospital_id", context.hospitalId)
        .maybeSingle();
      if (doctor?.signature_storage_path) {
        const { data: file } = await supabase.storage
          .from("documents")
          .download(doctor.signature_storage_path);
        if (file) {
          // One Buffer shared by every placement so the PDF embeds it once.
          const image = Buffer.from(await file.arrayBuffer());
          for (const b of signatureBoxes) {
            doctorSignatures.push({
              pageNumber: b.page,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              image,
            });
          }
        }
      }
    }
  }

  return { fields, seals, doctorSignatures };
}
