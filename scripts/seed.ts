/**
 * Dev-only seed script. Never run against a production project, and
 * never put real patient/staff data here (hard rule #5).
 *
 * Run after `supabase start` (or `supabase db reset`):
 *   npm run db:seed
 *
 * Deliberately NOT reused: src/lib/supabase/service-role.ts. That
 * module imports the "server-only" package, whose guard is only
 * meaningful (and only resolves correctly) inside Next.js's own
 * build/runtime. This script runs as a plain Node process via tsx, so
 * it constructs its own service-role client directly instead.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, ModuleType } from "../src/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in " +
      ".env.local (run `npx supabase status` after `supabase start` for local values).",
  );
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Obviously-fake, dev-only credential. Never used for anything but
// local/demo Supabase projects.
const DUMMY_PASSWORD = "demo-password-123!";

interface HospitalSeed {
  name: string;
  address: string;
  phone: string;
  email: string;
  modules: ModuleType[];
  admin: { name: string; email: string };
  receptionist: { name: string; email: string };
}

const PLATFORM_ADMIN = { name: "Demo Platform Admin", email: "super@platform.test" };

const HOSPITALS: HospitalSeed[] = [
  {
    name: "Sunrise General Hospital",
    address: "12 MG Road, Demo City",
    phone: "+91 90000 00001",
    email: "contact@sunrise.test",
    modules: ["GENERAL_OPD"],
    admin: { name: "Demo Admin (Sunrise)", email: "admin@sunrise.test" },
    receptionist: { name: "Demo Receptionist (Sunrise)", email: "reception@sunrise.test" },
  },
  {
    name: "Clarity Diagnostics",
    address: "45 Station Road, Demo City",
    phone: "+91 90000 00002",
    email: "contact@clarity.test",
    modules: ["USG"],
    admin: { name: "Demo Admin (Clarity)", email: "admin@clarity.test" },
    receptionist: { name: "Demo Receptionist (Clarity)", email: "reception@clarity.test" },
  },
  {
    name: "Wellspring Multispecialty",
    address: "8 Civil Lines, Demo City",
    phone: "+91 90000 00003",
    email: "contact@wellspring.test",
    modules: ["GENERAL_OPD", "USG"],
    admin: { name: "Demo Admin (Wellspring)", email: "admin@wellspring.test" },
    receptionist: { name: "Demo Receptionist (Wellspring)", email: "reception@wellspring.test" },
  },
];

async function createAuthUser(email: string, name: string) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DUMMY_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    throw error ?? new Error(`Failed to create auth user ${email}`);
  }
  return data.user;
}

async function main() {
  console.log("Seeding dummy data (no real patient or staff information)...\n");

  const superUser = await createAuthUser(PLATFORM_ADMIN.email, PLATFORM_ADMIN.name);
  const { error: superProfileError } = await supabase.from("profiles").insert({
    id: superUser.id,
    hospital_id: null,
    name: PLATFORM_ADMIN.name,
    email: PLATFORM_ADMIN.email,
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  });
  if (superProfileError) throw superProfileError;

  const { error: platformAdminError } = await supabase
    .from("platform_admins")
    .insert({ profile_id: superUser.id });
  if (platformAdminError) throw platformAdminError;

  console.log(`Platform admin : ${PLATFORM_ADMIN.email}`);

  for (const hospitalSeed of HOSPITALS) {
    const { data: hospital, error: hospitalError } = await supabase
      .from("hospitals")
      .insert({
        name: hospitalSeed.name,
        address: hospitalSeed.address,
        phone: hospitalSeed.phone,
        email: hospitalSeed.email,
        status: "ACTIVE",
      })
      .select()
      .single();
    if (hospitalError || !hospital) {
      throw hospitalError ?? new Error(`Failed to insert hospital ${hospitalSeed.name}`);
    }

    const { error: modulesError } = await supabase
      .from("hospital_modules")
      .insert(hospitalSeed.modules.map((module) => ({ hospital_id: hospital.id, module })));
    if (modulesError) throw modulesError;

    const adminUser = await createAuthUser(hospitalSeed.admin.email, hospitalSeed.admin.name);
    const { error: adminProfileError } = await supabase.from("profiles").insert({
      id: adminUser.id,
      hospital_id: hospital.id,
      name: hospitalSeed.admin.name,
      email: hospitalSeed.admin.email,
      role: "HOSPITAL_ADMIN",
      status: "ACTIVE",
    });
    if (adminProfileError) throw adminProfileError;

    const receptionistUser = await createAuthUser(
      hospitalSeed.receptionist.email,
      hospitalSeed.receptionist.name,
    );
    const { error: receptionistProfileError } = await supabase.from("profiles").insert({
      id: receptionistUser.id,
      hospital_id: hospital.id,
      name: hospitalSeed.receptionist.name,
      email: hospitalSeed.receptionist.email,
      role: "RECEPTIONIST",
      status: "ACTIVE",
    });
    if (receptionistProfileError) throw receptionistProfileError;

    const doctorNames = [`Dr. Demo Physician (${hospitalSeed.name})`];
    const { error: doctorsError } = await supabase
      .from("doctors")
      .insert(doctorNames.map((name) => ({ hospital_id: hospital.id, name })));
    if (doctorsError) throw doctorsError;

    const visitTypes: { module: ModuleType; name: string }[] = [];
    if (hospitalSeed.modules.includes("GENERAL_OPD")) {
      visitTypes.push({ module: "GENERAL_OPD", name: "OPD Consultation" });
    }
    if (hospitalSeed.modules.includes("USG")) {
      visitTypes.push(
        { module: "USG", name: "General USG" },
        { module: "USG", name: "Abdomen & Pelvis" },
        { module: "USG", name: "Pregnancy/Obstetric USG" },
      );
    }
    const { data: insertedVisitTypes, error: visitTypesError } = await supabase
      .from("visit_types")
      .insert(visitTypes.map((vt) => ({ hospital_id: hospital.id, ...vt })))
      .select();
    if (visitTypesError) throw visitTypesError;

    // Document types + which visit types expect them. Phase 6 builds
    // the admin UI to edit these; the seed just needs enough rows to
    // demo document upload and the "Pending Documents" view.
    const { data: idProofType, error: idProofError } = await supabase
      .from("document_types")
      .insert({
        hospital_id: hospital.id,
        name: "ID Proof",
        scope: "PATIENT",
        sensitive: true,
        two_sided: true,
      })
      .select()
      .single();
    if (idProofError || !idProofType) throw idProofError;

    // A second ID slot for the guardian / husband / relative who comes
    // with the patient. Not required by default -- the Admin decides per
    // visit type in Settings.
    const { error: guardianIdError } = await supabase.from("document_types").insert({
      hospital_id: hospital.id,
      name: "Guardian / Relative ID Proof",
      description: "ID of the husband, parent or other relative accompanying the patient.",
      scope: "PATIENT",
      sensitive: true,
      two_sided: true,
    });
    if (guardianIdError) throw guardianIdError;

    const requirements: { visit_type_id: string; document_type_id: string }[] = (
      insertedVisitTypes ?? []
    ).map((vt) => ({ visit_type_id: vt.id, document_type_id: idProofType.id }));

    if (hospitalSeed.modules.includes("GENERAL_OPD")) {
      const { data: opdSlipType, error: opdSlipError } = await supabase
        .from("document_types")
        .insert({
          hospital_id: hospital.id,
          name: "OPD Slip / Prescription",
          scope: "VISIT",
          sensitive: false,
        })
        .select()
        .single();
      if (opdSlipError || !opdSlipType) throw opdSlipError;

      const opdConsultation = insertedVisitTypes?.find((vt) => vt.name === "OPD Consultation");
      if (opdConsultation) {
        requirements.push({
          visit_type_id: opdConsultation.id,
          document_type_id: opdSlipType.id,
        });
      }
    }

    if (hospitalSeed.modules.includes("USG")) {
      const { data: usgReportType, error: usgReportError } = await supabase
        .from("document_types")
        .insert({
          hospital_id: hospital.id,
          name: "USG Report",
          scope: "VISIT",
          sensitive: false,
        })
        .select()
        .single();
      if (usgReportError || !usgReportType) throw usgReportError;

      const usgVisitTypes = (insertedVisitTypes ?? []).filter((vt) => vt.module === "USG");
      for (const vt of usgVisitTypes) {
        requirements.push({ visit_type_id: vt.id, document_type_id: usgReportType.id });
      }

      // Phase 7: PC-PNDT declaration, applicable only to pregnancy/
      // obstetric exams (per the brief, "For pregnancy/obstetric USG,
      // support centre-configured... PC-PNDT documentation").
      const { data: pcPndtType, error: pcPndtError } = await supabase
        .from("document_types")
        .insert({
          hospital_id: hospital.id,
          name: "PC-PNDT Declaration",
          scope: "VISIT",
          sensitive: false,
          pc_pndt_form: true,
        })
        .select()
        .single();
      if (pcPndtError || !pcPndtType) throw pcPndtError;

      const pregnancyUsg = insertedVisitTypes?.find((vt) => vt.name === "Pregnancy/Obstetric USG");
      if (pregnancyUsg) {
        requirements.push({ visit_type_id: pregnancyUsg.id, document_type_id: pcPndtType.id });
      }
    }

    const { error: requirementsError } = await supabase
      .from("visit_type_document_requirements")
      .insert(requirements.map((r) => ({ hospital_id: hospital.id, ...r, required: true })));
    if (requirementsError) throw requirementsError;

    if (hospitalSeed.name === "Sunrise General Hospital") {
      // A pre-deactivated account, for exercising the "deactivated
      // staff cannot log in" path (Phase 1c) without needing a live
      // admin session to deactivate one first.
      const deactivatedUser = await createAuthUser(
        "deactivated@sunrise.test",
        "Demo Deactivated (Sunrise)",
      );
      const { error: deactivatedProfileError } = await supabase.from("profiles").insert({
        id: deactivatedUser.id,
        hospital_id: hospital.id,
        name: "Demo Deactivated (Sunrise)",
        email: "deactivated@sunrise.test",
        role: "RECEPTIONIST",
        status: "INACTIVE",
      });
      if (deactivatedProfileError) throw deactivatedProfileError;
    }

    console.log(
      `${hospitalSeed.name.padEnd(15)}: admin=${hospitalSeed.admin.email}  receptionist=${hospitalSeed.receptionist.email}`,
    );
  }

  console.log(`\nAll seeded accounts share the password: ${DUMMY_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:", error);
    console.error(
      "\nIf this is a duplicate-key error, the seed has probably already run — " +
        "`npx supabase db reset` for a clean slate before re-seeding.",
    );
    process.exit(1);
  });
