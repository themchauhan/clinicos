import { afterAll, describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, serviceRoleClient, signInAs } from "./helpers";

// Same as form-templates.rls.test.ts: RLS needs bytes, not a real PDF.
const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

type Client = Awaited<ReturnType<typeof signInAs>>;

// Retired afterwards (marked inactive) so repeated local runs don't pile
// up visit types and templates in the settings screens.
const createdVisitTypeIds: string[] = [];
const createdTemplateIds: string[] = [];

afterAll(async () => {
  const sr = serviceRoleClient();
  if (createdVisitTypeIds.length)
    await sr.from("visit_types").update({ active: false }).in("id", createdVisitTypeIds);
  if (createdTemplateIds.length)
    await sr.from("form_templates").update({ active: false }).in("id", createdTemplateIds);
});

async function makeTemplate(client: Client, hospitalId: string, name: string) {
  const storagePath = `${hospitalId}/form-templates/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await client.storage
    .from("documents")
    .upload(storagePath, FAKE_PDF, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  const { data, error } = await client
    .from("form_templates")
    .insert({
      name,
      storage_path: storagePath,
      page_width: 595,
      page_height: 842,
      signature_x: 50,
      signature_y: 100,
      signature_width: 150,
      signature_height: 50,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("failed to create form template");
  return data;
}

async function makeVisitType(client: Client, name: string) {
  const { data, error } = await client
    .from("visit_types")
    .insert({ name, module: "USG", default_fee: 100 })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("failed to create visit type");
  return data;
}

async function sunriseSetup() {
  const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
  const { data: profile } = await admin.from("patients").select("hospital_id").limit(1).single();
  const hospitalId = profile!.hospital_id;
  const stamp = Date.now();
  const template = await makeTemplate(admin, hospitalId, `Form Req Test Form ${stamp}`);
  const visitType = await makeVisitType(admin, `Form Req Test Type ${stamp}`);
  createdVisitTypeIds.push(visitType.id);
  createdTemplateIds.push(template.id);
  return { admin, hospitalId, template, visitType };
}

describe("form requirements RLS", { timeout: 20_000 }, () => {
  it("a HOSPITAL_ADMIN sets a rule; new visits snapshot it, and a later change leaves them alone", async () => {
    const { admin, template, visitType } = await sunriseSetup();

    const { error: ruleError } = await admin
      .from("visit_type_form_requirements")
      .insert({ visit_type_id: visitType.id, form_template_id: template.id, required: true });
    expect(ruleError).toBeNull();

    const { data: patient } = await admin
      .from("patients")
      .insert({ name: "Form Requirement Testperson" })
      .select()
      .single();
    const { data: visit, error: visitError } = await admin
      .from("visits")
      .insert({ patient_id: patient!.id, visit_type_id: visitType.id, fee_amount: 100 })
      .select()
      .single();
    expect(visitError).toBeNull();

    const { data: snapshot } = await admin
      .from("visit_form_requirements")
      .select("form_template_id, form_template_name, required")
      .eq("visit_id", visit!.id);
    expect(snapshot).toEqual([
      { form_template_id: template.id, form_template_name: template.name, required: true },
    ]);

    // Removing the rule never rewrites an existing visit's checklist...
    await admin
      .from("visit_type_form_requirements")
      .delete()
      .eq("visit_type_id", visitType.id)
      .eq("form_template_id", template.id);
    const { data: stillThere } = await admin
      .from("visit_form_requirements")
      .select("id")
      .eq("visit_id", visit!.id);
    expect(stillThere).toHaveLength(1);

    // ...and a visit created after the removal has none.
    const { data: laterVisit } = await admin
      .from("visits")
      .insert({ patient_id: patient!.id, visit_type_id: visitType.id, fee_amount: 100 })
      .select()
      .single();
    const { data: laterSnapshot } = await admin
      .from("visit_form_requirements")
      .select("id")
      .eq("visit_id", laterVisit!.id);
    expect(laterSnapshot).toHaveLength(0);
  });

  it("missing/invalid input: a rule needs a real visit type and form, and can't be duplicated", async () => {
    const { admin, template, visitType } = await sunriseSetup();

    const first = await admin
      .from("visit_type_form_requirements")
      .insert({ visit_type_id: visitType.id, form_template_id: template.id });
    expect(first.error).toBeNull();

    const duplicate = await admin
      .from("visit_type_form_requirements")
      .insert({ visit_type_id: visitType.id, form_template_id: template.id });
    expect(duplicate.error).not.toBeNull();

    const bogus = await admin.from("visit_type_form_requirements").insert({
      visit_type_id: visitType.id,
      form_template_id: crypto.randomUUID(),
    });
    expect(bogus.error).not.toBeNull();
  });

  it("a RECEPTIONIST can read the rules but not change them", async () => {
    const { admin, template, visitType } = await sunriseSetup();
    await admin
      .from("visit_type_form_requirements")
      .insert({ visit_type_id: visitType.id, form_template_id: template.id });

    const reception = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: readable } = await reception
      .from("visit_type_form_requirements")
      .select("id")
      .eq("visit_type_id", visitType.id);
    expect(readable).toHaveLength(1);

    const blocked = await reception
      .from("visit_type_form_requirements")
      .update({ required: false })
      .eq("visit_type_id", visitType.id)
      .select();
    expect(blocked.data ?? []).toHaveLength(0);

    const blockedDelete = await reception
      .from("visit_type_form_requirements")
      .delete()
      .eq("visit_type_id", visitType.id)
      .select();
    expect(blockedDelete.data ?? []).toHaveLength(0);

    const { data: unchanged } = await serviceRoleClient()
      .from("visit_type_form_requirements")
      .select("required")
      .eq("visit_type_id", visitType.id)
      .single();
    expect(unchanged?.required).toBe(true);
  });

  it("cross-tenant: another hospital can't see, edit, or attach a rule to this one's forms", async () => {
    const { admin, template, visitType } = await sunriseSetup();
    await admin
      .from("visit_type_form_requirements")
      .insert({ visit_type_id: visitType.id, form_template_id: template.id });

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: seen } = await clarity
      .from("visit_type_form_requirements")
      .select("id")
      .eq("visit_type_id", visitType.id);
    expect(seen).toHaveLength(0);

    const { data: clarityVisitType } = await serviceRoleClient()
      .from("visit_types")
      .select("id")
      .eq(
        "hospital_id",
        (await clarity.from("visit_types").select("hospital_id").limit(1).single()).data!
          .hospital_id,
      )
      .limit(1)
      .single();

    // Clarity's visit type + Sunrise's form: the composite foreign key
    // (form_template_id, hospital_id) rejects it.
    const forged = await clarity.from("visit_type_form_requirements").insert({
      visit_type_id: clarityVisitType!.id,
      form_template_id: template.id,
    });
    expect(forged.error).not.toBeNull();

    const wiped = await clarity
      .from("visit_type_form_requirements")
      .delete()
      .eq("visit_type_id", visitType.id)
      .select();
    expect(wiped.data ?? []).toHaveLength(0);
  });
});
