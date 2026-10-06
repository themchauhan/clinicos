import { afterAll, describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, anonClient, serviceRoleClient, signInAs } from "./helpers";

type Client = Awaited<ReturnType<typeof signInAs>>;

// Rows these tests create are retired afterwards (marked inactive, the
// app's own convention -- nothing is hard-deleted), so repeated local runs
// don't pile up visit types and form templates in the settings screens.
const createdVisitTypeIds: string[] = [];
const createdTemplateIds: string[] = [];

afterAll(async () => {
  const sr = serviceRoleClient();
  if (createdVisitTypeIds.length)
    await sr.from("visit_types").update({ active: false }).in("id", createdVisitTypeIds);
  if (createdTemplateIds.length)
    await sr.from("form_templates").update({ active: false }).in("id", createdTemplateIds);
});

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

async function typeId(admin: Client, name: string): Promise<string> {
  const { data, error } = await admin
    .from("document_types")
    .select("id")
    .eq("name", name)
    .eq("active", true)
    .single();
  if (error || !data) throw error ?? new Error(`document type ${name} not found`);
  return data.id;
}

async function addDocument(
  admin: Client,
  patientId: string,
  visitId: string | null,
  kind: { documentTypeId: string } | { formTemplateId: string },
) {
  const { error } = await admin.from("documents").insert({
    patient_id: patientId,
    visit_id: visitId,
    document_type_id: "documentTypeId" in kind ? kind.documentTypeId : null,
    form_template_id: "formTemplateId" in kind ? kind.formTemplateId : null,
    file_name: "x.pdf",
    file_type: "application/pdf",
    storage_path: `test/${crypto.randomUUID()}.pdf`,
    file_size: FAKE_PDF.byteLength,
    sha256: "test-hash",
  });
  if (error) throw error;
}

async function pendingFor(client: Client, visitId: string): Promise<string[]> {
  const { data } = await client
    .from("pending_visit_requirements")
    .select("missing_name")
    .eq("visit_id", visitId);
  return (data ?? []).map((r) => r.missing_name).sort();
}

async function setup() {
  const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
  const stamp = Date.now();
  const idProof = await typeId(admin, "ID Proof"); // PATIENT scope
  const visitScopeType = await typeId(admin, "OPD Slip / Prescription"); // VISIT scope

  const { data: visitType } = await admin
    .from("visit_types")
    .insert({ name: `Pending View Test Type ${stamp}`, module: "GENERAL_OPD", default_fee: 0 })
    .select()
    .single();
  const { data: patient } = await admin
    .from("patients")
    .insert({ name: "Pending View Testperson" })
    .select()
    .single();

  const storagePath = `${patient!.hospital_id}/form-templates/${crypto.randomUUID()}.pdf`;
  await admin.storage.from("documents").upload(storagePath, FAKE_PDF, {
    contentType: "application/pdf",
  });
  const { data: template } = await admin
    .from("form_templates")
    .insert({
      name: `Pending View Form ${stamp}`,
      storage_path: storagePath,
      page_width: 595,
      page_height: 842,
      signature_x: 1,
      signature_y: 1,
      signature_width: 1,
      signature_height: 1,
    })
    .select()
    .single();

  createdVisitTypeIds.push(visitType!.id);
  createdTemplateIds.push(template!.id);
  await admin.from("visit_type_document_requirements").insert([
    { visit_type_id: visitType!.id, document_type_id: idProof, required: true },
    { visit_type_id: visitType!.id, document_type_id: visitScopeType, required: true },
  ]);
  await admin
    .from("visit_type_form_requirements")
    .insert({ visit_type_id: visitType!.id, form_template_id: template!.id, required: true });

  const newVisit = async () => {
    const { data } = await admin
      .from("visits")
      .insert({ patient_id: patient!.id, visit_type_id: visitType!.id, fee_amount: 0 })
      .select()
      .single();
    return data!;
  };
  return { admin, patient: patient!, template: template!, idProof, visitScopeType, newVisit };
}

describe("pending_visit_requirements view", () => {
  it("lists missing documents and forms, and drops each as it is fulfilled", async () => {
    const { admin, patient, template, idProof, visitScopeType, newVisit } = await setup();
    const visit = await newVisit();

    expect(await pendingFor(admin, visit.id)).toEqual(
      ["ID Proof", "OPD Slip / Prescription", `${template.name} (form)`].sort(),
    );

    await addDocument(admin, patient.id, null, { documentTypeId: idProof });
    expect(await pendingFor(admin, visit.id)).toEqual(
      ["OPD Slip / Prescription", `${template.name} (form)`].sort(),
    );

    await addDocument(admin, patient.id, visit.id, { documentTypeId: visitScopeType });
    expect(await pendingFor(admin, visit.id)).toEqual([`${template.name} (form)`]);

    await addDocument(admin, patient.id, visit.id, { formTemplateId: template.id });
    expect(await pendingFor(admin, visit.id)).toEqual([]);

    const { data: summary } = await admin
      .from("visits_with_pending_requirements")
      .select("visit_id")
      .eq("visit_id", visit.id);
    expect(summary).toHaveLength(0);
  });

  it("a visit-scope document or signed form from an earlier visit does not satisfy a later one; a patient-scope one does", async () => {
    const { admin, patient, template, idProof, visitScopeType, newVisit } = await setup();
    const first = await newVisit();
    await addDocument(admin, patient.id, null, { documentTypeId: idProof });
    await addDocument(admin, patient.id, first.id, { documentTypeId: visitScopeType });
    await addDocument(admin, patient.id, first.id, { formTemplateId: template.id });

    const second = await newVisit();
    // ID Proof (patient-scope) carries over; the slip and form do not.
    expect(await pendingFor(admin, second.id)).toEqual(
      ["OPD Slip / Prescription", `${template.name} (form)`].sort(),
    );

    const { data: summary } = await admin
      .from("visits_with_pending_requirements")
      .select("visit_id")
      .eq("visit_id", second.id);
    expect(summary).toHaveLength(1);

    // A cancelled visit needs nothing.
    await admin.from("visits").update({ status: "CANCELLED" }).eq("id", second.id);
    expect(await pendingFor(admin, second.id)).toEqual([]);
  });

  it("a soft-deleted document no longer counts as fulfilling", async () => {
    const { admin, patient, idProof, newVisit } = await setup();
    const visit = await newVisit();
    await addDocument(admin, patient.id, null, { documentTypeId: idProof });
    expect(await pendingFor(admin, visit.id)).not.toContain("ID Proof");

    // Soft delete isn't something a user session can do directly.
    await serviceRoleClient()
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("patient_id", patient.id)
      .eq("document_type_id", idProof);
    expect(await pendingFor(admin, visit.id)).toContain("ID Proof");
  });

  it("cross-tenant and signed-out: nobody else can see another hospital's pending rows", async () => {
    const { admin, newVisit } = await setup();
    const visit = await newVisit();
    expect((await pendingFor(admin, visit.id)).length).toBeGreaterThan(0);

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    expect(await pendingFor(clarity, visit.id)).toEqual([]);

    const anon = anonClient();
    const { data } = await anon
      .from("pending_visit_requirements")
      .select("visit_id")
      .eq("visit_id", visit.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("the maintenance function is not callable over the API by anyone", async () => {
    // refresh_pending_requirements rebuilds pending items (for every
    // centre when called with null). It must stay trigger-only.
    const call = (client: { rpc: (fn: never, args: never) => PromiseLike<{ error: unknown }> }) =>
      client.rpc("refresh_pending_requirements" as never, { p_patient_id: null } as never);

    const { error: anonError } = await call(anonClient() as never);
    expect(anonError).not.toBeNull();

    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { error: adminError } = await call(admin as never);
    expect(adminError).not.toBeNull();

    // ...and the triggers that own that job still work after the revoke:
    // adding a document cleared the pending item in the first test above.
  });
});
