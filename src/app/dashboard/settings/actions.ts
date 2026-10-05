"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant, AuthError } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { validateFile } from "@/lib/documents/file-validation";
import type { ModuleType, DocumentScope } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 60;

// Each settings area now lives on its own page (see
// src/app/dashboard/settings/(sections)/*) -- revalidate the specific
// page a change actually shows up on, not just the Overview root.
const OVERVIEW_PATH = "/dashboard/settings";
const VISIT_TYPES_PATH = "/dashboard/settings/visit-types";
const DOCTORS_PATH = "/dashboard/settings/doctors";
const DOCUMENT_TYPES_PATH = "/dashboard/settings/document-types";
const FORMS_PATH = "/dashboard/settings/forms";

export async function enableModule(module: ModuleType): Promise<{ error?: string }> {
  const profile = requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase
    .from("hospital_modules")
    .insert({ hospital_id: profile.hospitalId!, module });

  if (error) {
    return { error: "Could not enable that module." };
  }

  await logAudit({
    action: "module.enabled",
    targetType: "hospital_modules",
    metadata: { module },
  });
  revalidatePath(OVERVIEW_PATH);
  return {};
}

export async function disableModule(module: ModuleType): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase.from("hospital_modules").delete().eq("module", module);

  if (error) {
    return { error: "Could not disable that module." };
  }

  await logAudit({
    action: "module.disabled",
    targetType: "hospital_modules",
    metadata: { module },
  });
  revalidatePath(OVERVIEW_PATH);
  return {};
}

export interface VisitTypeFormState {
  error?: string;
}

export async function createVisitType(
  _prevState: VisitTypeFormState,
  formData: FormData,
): Promise<VisitTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));
  return upsertVisitType(null, formData);
}

export async function updateVisitType(
  visitTypeId: string,
  _prevState: VisitTypeFormState,
  formData: FormData,
): Promise<VisitTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));
  return upsertVisitType(visitTypeId, formData);
}

async function upsertVisitType(
  visitTypeId: string | null,
  formData: FormData,
): Promise<VisitTypeFormState> {
  const visitTypeModule = String(formData.get("module") ?? "") as ModuleType;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const defaultFeeRaw = String(formData.get("defaultFee") ?? "").trim();
  const defaultFee = defaultFeeRaw ? Number(defaultFeeRaw) : null;
  const active = formData.get("active") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }
  if (visitTypeModule !== "GENERAL_OPD" && visitTypeModule !== "USG") {
    return { error: "Choose a module." };
  }
  if (defaultFee !== null && (Number.isNaN(defaultFee) || defaultFee < 0)) {
    return { error: "Default fee must be a positive number." };
  }

  const supabase = await createClient();
  const values = { module: visitTypeModule, name, description, default_fee: defaultFee, active };
  const { error } = visitTypeId
    ? await supabase.from("visit_types").update(values).eq("id", visitTypeId)
    : await supabase.from("visit_types").insert(values);

  if (error) {
    return { error: "Could not save that visit type." };
  }

  await logAudit({
    action: visitTypeId ? "visit_type.updated" : "visit_type.created",
    targetType: "visit_type",
    targetId: visitTypeId ?? undefined,
  });
  revalidatePath(VISIT_TYPES_PATH);
  return {};
}

export interface DoctorFormState {
  error?: string;
}

export async function createDoctor(
  _prevState: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Enter a name." };
  }
  const registrationNo = String(formData.get("registrationNo") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("doctors")
    .insert({ name, registration_no: registrationNo });

  if (error) {
    return { error: "Could not add that doctor." };
  }

  await logAudit({ action: "doctor.created", targetType: "doctor" });
  revalidatePath(DOCTORS_PATH);
  return {};
}

// Returns void (throws on failure) rather than {error?} so this can be
// bound directly as a <form action={...}>, same as setStaffStatus.
export async function setDoctorStatus(doctorId: string, active: boolean): Promise<void> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase.from("doctors").update({ active }).eq("id", doctorId);

  if (error) {
    throw new AuthError("Could not update that doctor.", 403);
  }

  await logAudit({
    action: "doctor.status_changed",
    targetType: "doctor",
    targetId: doctorId,
    metadata: { active },
  });
  revalidatePath(DOCTORS_PATH);
}

/**
 * Doctors otherwise have no edit path at all (only create + active
 * toggle) -- but a wrong registration number on a compliance form
 * (e.g. PC&PNDT Form G) is a real risk, so this one field gets a
 * narrow edit action rather than requiring a whole doctor to be
 * recreated to fix a typo.
 */
export async function updateDoctorRegistrationNo(
  doctorId: string,
  formData: FormData,
): Promise<void> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const registrationNo = String(formData.get("registrationNo") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("doctors")
    .update({ registration_no: registrationNo })
    .eq("id", doctorId);

  if (error) {
    throw new AuthError("Could not update that doctor.", 403);
  }

  await logAudit({
    action: "doctor.registration_no_updated",
    targetType: "doctor",
    targetId: doctorId,
  });
  revalidatePath(DOCTORS_PATH);
}

export interface DocumentTypeFormState {
  error?: string;
}

export async function createDocumentType(
  _prevState: DocumentTypeFormState,
  formData: FormData,
): Promise<DocumentTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "") as DocumentScope;
  const sensitive = formData.get("sensitive") === "on";
  const pcPndtForm = formData.get("pcPndtForm") === "on";
  const requiresSignature = formData.get("requiresSignature") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }
  if (scope !== "PATIENT" && scope !== "VISIT") {
    return { error: "Choose a scope." };
  }

  const supabase = await createClient();

  // Creating a document type with the same name as an existing one is
  // treated as superseding it with a new version (per document_types'
  // own version/effective_from columns, unused since Phase 4 for
  // exactly this) -- the version number is always server-derived,
  // never trusted from the client.
  const { data: priorVersions } = await supabase
    .from("document_types")
    .select("id, version")
    .eq("name", name);
  const nextVersion =
    priorVersions && priorVersions.length > 0
      ? Math.max(...priorVersions.map((v) => v.version)) + 1
      : 1;

  const { error } = await supabase.from("document_types").insert({
    name,
    description,
    scope,
    sensitive,
    pc_pndt_form: pcPndtForm,
    requires_signature: requiresSignature,
    version: nextVersion,
    effective_from: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    return { error: "Could not save that document type." };
  }

  if (priorVersions && priorVersions.length > 0) {
    await supabase
      .from("document_types")
      .update({ active: false })
      .in(
        "id",
        priorVersions.map((v) => v.id),
      );
  }

  await logAudit({
    action: "document_type.created",
    targetType: "document_type",
    metadata: { name, version: nextVersion, superseded: priorVersions?.length ?? 0 },
  });
  revalidatePath(DOCUMENT_TYPES_PATH);
  return {};
}

export async function updateDocumentType(
  documentTypeId: string,
  _prevState: DocumentTypeFormState,
  formData: FormData,
): Promise<DocumentTypeFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const sensitive = formData.get("sensitive") === "on";
  const pcPndtForm = formData.get("pcPndtForm") === "on";
  const requiresSignature = formData.get("requiresSignature") === "on";
  const active = formData.get("active") === "on";

  if (!name) {
    return { error: "Enter a name." };
  }

  // scope is intentionally not editable here: changing PATIENT<->VISIT
  // on a type already attached to real documents would be a data-
  // integrity trap, not a simple field edit. version/effective_from
  // are likewise not editable in place -- create a new document type
  // with the same name instead, which supersedes this one as a new
  // version (see createDocumentType).
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_types")
    .update({
      name,
      description,
      sensitive,
      pc_pndt_form: pcPndtForm,
      requires_signature: requiresSignature,
      active,
    })
    .eq("id", documentTypeId);

  if (error) {
    return { error: "Could not save that document type." };
  }

  await logAudit({
    action: "document_type.updated",
    targetType: "document_type",
    targetId: documentTypeId,
  });
  revalidatePath(DOCUMENT_TYPES_PATH);
  return {};
}

export async function setRequirement(
  visitTypeId: string,
  documentTypeId: string,
  required: boolean | null,
): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();

  if (required === null) {
    const { error } = await supabase
      .from("visit_type_document_requirements")
      .delete()
      .eq("visit_type_id", visitTypeId)
      .eq("document_type_id", documentTypeId);
    if (error) return { error: "Could not update that requirement." };
  } else {
    const { data: existing } = await supabase
      .from("visit_type_document_requirements")
      .select("id")
      .eq("visit_type_id", visitTypeId)
      .eq("document_type_id", documentTypeId)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("visit_type_document_requirements")
          .update({ required })
          .eq("id", existing.id)
      : await supabase
          .from("visit_type_document_requirements")
          .insert({ visit_type_id: visitTypeId, document_type_id: documentTypeId, required });
    if (error) return { error: "Could not update that requirement." };
  }

  await logAudit({
    action: "visit_type_document_requirement.updated",
    targetType: "visit_type",
    targetId: visitTypeId,
    metadata: { document_type_id: documentTypeId, required },
  });
  revalidatePath(DOCUMENT_TYPES_PATH);
  return {};
}

/** Same tri-state as setRequirement, for fillable forms: null removes
 * the rule, true/false makes the form required/optional for the visit
 * type. New visits snapshot it; existing visits are unaffected. */
export async function setFormRequirement(
  visitTypeId: string,
  formTemplateId: string,
  required: boolean | null,
): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();

  if (required === null) {
    const { error } = await supabase
      .from("visit_type_form_requirements")
      .delete()
      .eq("visit_type_id", visitTypeId)
      .eq("form_template_id", formTemplateId);
    if (error) return { error: "Could not update that requirement." };
  } else {
    const { data: existing } = await supabase
      .from("visit_type_form_requirements")
      .select("id")
      .eq("visit_type_id", visitTypeId)
      .eq("form_template_id", formTemplateId)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("visit_type_form_requirements")
          .update({ required })
          .eq("id", existing.id)
      : await supabase
          .from("visit_type_form_requirements")
          .insert({ visit_type_id: visitTypeId, form_template_id: formTemplateId, required });
    if (error) return { error: "Could not update that requirement." };
  }

  await logAudit({
    action: "visit_type_form_requirement.updated",
    targetType: "visit_type",
    targetId: visitTypeId,
    metadata: { form_template_id: formTemplateId, required },
  });
  revalidatePath("/dashboard/settings/forms");
  return {};
}

export interface HospitalFormProfileState {
  error?: string;
}

/**
 * Upserts the single hospital_form_profile row -- a "fact sheet" of
 * letterhead-style facts (centre name/address override, PC&PNDT
 * registration number) that form template fields can be sourced from
 * instead of retyped at fill-time (see
 * src/lib/documents/form-field-sources.ts). Deliberately not on
 * `hospitals` itself, whose UPDATE policy is platform-admin-only.
 */
export async function saveHospitalFormProfile(
  _prevState: HospitalFormProfileState,
  formData: FormData,
): Promise<HospitalFormProfileState> {
  const profile = requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const centreName = String(formData.get("centreName") ?? "").trim() || null;
  const centreAddress = String(formData.get("centreAddress") ?? "").trim() || null;
  const registrationNo = String(formData.get("registrationNo") ?? "").trim() || null;

  const supabase = await createClient();

  // The seal is optional and only re-uploaded when staff picks a new
  // file -- a blank file input here must never clear an already-saved
  // seal, unlike the text fields above which are fully replaced every
  // save (a blank text field is a deliberate "clear this").
  let sealStoragePath: string | undefined;
  const sealFile = formData.get("seal");
  if (sealFile instanceof File && sealFile.size > 0) {
    const rawBuffer = Buffer.from(await sealFile.arrayBuffer());
    const validated = validateFile(rawBuffer);
    if ("error" in validated) {
      return { error: validated.error };
    }
    if (validated.mime !== "image/png" && validated.mime !== "image/jpeg") {
      return { error: "The seal must be a PNG or JPEG image." };
    }
    sealStoragePath = `${profile.hospitalId}/hospital-facts/seal.${validated.ext}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(sealStoragePath, rawBuffer, { contentType: validated.mime, upsert: true });
    if (uploadError) {
      return { error: "Could not upload the seal image. Try again." };
    }
  }

  const { error } = await supabase.from("hospital_form_profile").upsert(
    {
      hospital_id: profile.hospitalId!,
      centre_name: centreName,
      centre_address: centreAddress,
      registration_no: registrationNo,
      ...(sealStoragePath ? { seal_storage_path: sealStoragePath } : {}),
    },
    { onConflict: "hospital_id" },
  );

  if (error) {
    return { error: "Could not save these details." };
  }

  await logAudit({ action: "hospital_form_profile.updated", targetType: "hospital_form_profile" });
  revalidatePath(FORMS_PATH);
  return {};
}

/** Signed URL for the hospital's saved seal image, for a preview
 * thumbnail in Settings -- same private-bucket pattern as
 * getFormTemplateViewUrl. */
export async function getHospitalSealViewUrl(): Promise<{ url: string } | { error: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("hospital_form_profile")
    .select("seal_storage_path")
    .maybeSingle();
  if (!profile?.seal_storage_path) {
    return { error: "No seal uploaded yet." };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(profile.seal_storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    return { error: "Could not load the seal image." };
  }
  return { url: signed.signedUrl };
}

/**
 * A doctor's own saved signature image -- same idea as the hospital
 * seal (saveHospitalFormProfile above), scoped per doctor instead of
 * per hospital, so forms that place a "Doctor's signature" box can
 * stamp it automatically without the doctor signing each one by hand.
 */
export async function uploadDoctorSignature(doctorId: string, formData: FormData): Promise<void> {
  const profile = requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) {
    throw new AuthError("Choose a signature image to upload.", 403);
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const validated = validateFile(rawBuffer);
  if ("error" in validated) {
    throw new AuthError(validated.error, 403);
  }
  if (validated.mime !== "image/png" && validated.mime !== "image/jpeg") {
    throw new AuthError("The signature must be a PNG or JPEG image.", 403);
  }

  const supabase = await createClient();
  const signatureStoragePath = `${profile.hospitalId}/doctors/${doctorId}/signature.${validated.ext}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(signatureStoragePath, rawBuffer, { contentType: validated.mime, upsert: true });
  if (uploadError) {
    throw new AuthError("Could not upload the signature image. Try again.", 403);
  }

  const { error } = await supabase
    .from("doctors")
    .update({ signature_storage_path: signatureStoragePath })
    .eq("id", doctorId);
  if (error) {
    throw new AuthError("Could not save that doctor.", 403);
  }

  await logAudit({
    action: "doctor.signature_updated",
    targetType: "doctor",
    targetId: doctorId,
  });
  revalidatePath(DOCTORS_PATH);
}

/** Signed URL for a doctor's saved signature image, for a preview
 * thumbnail in Settings -- same pattern as getHospitalSealViewUrl. */
export async function getDoctorSignatureViewUrl(
  doctorId: string,
): Promise<{ url: string } | { error: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { data: doctor } = await supabase
    .from("doctors")
    .select("signature_storage_path")
    .eq("id", doctorId)
    .maybeSingle();
  if (!doctor?.signature_storage_path) {
    return { error: "No signature uploaded yet." };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doctor.signature_storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    return { error: "Could not load the signature image." };
  }
  return { url: signed.signedUrl };
}
