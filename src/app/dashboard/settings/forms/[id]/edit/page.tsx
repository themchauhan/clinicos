import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { EditFormTemplateForm } from "./edit-form-template-form";

export const metadata: Metadata = { title: "Edit form fields — ClinicOS" };

// Long enough for an admin to spend a few minutes repositioning
// fields without the blank PDF's signed URL expiring mid-edit --
// unlike the quick "open and view" signed URLs elsewhere in this
// feature, which only need to survive one click.
const EDIT_SESSION_URL_TTL_SECONDS = 15 * 60;

export default async function EditFormTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getSessionProfile();
  if (!profile) {
    redirect(`/login?next=/dashboard/settings/forms/${id}/edit`);
  }
  if (profile.role !== "HOSPITAL_ADMIN") {
    redirect("/dashboard/settings/forms");
  }

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("form_templates")
    .select("*, form_template_fields(*)")
    .eq("id", id)
    .maybeSingle();
  if (!template) {
    notFound();
  }

  const { data: signed } = await supabase.storage
    .from("documents")
    .createSignedUrl(template.storage_path, EDIT_SESSION_URL_TTL_SECONDS);
  if (!signed) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard/settings/forms" label="Forms" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Edit fields: {template.name}</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        Reposition, add, or remove fields on the same uploaded form. This never affects documents
        already signed from this template -- those are saved as their own flattened copy,
        independent of anything changed here.
      </p>
      <div className="mt-8">
        <EditFormTemplateForm
          templateId={template.id}
          pdfUrl={signed.signedUrl}
          initialFields={(template.form_template_fields ?? [])
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((f) => ({
              fieldKey: f.field_key,
              label: f.label,
              inputType: f.input_type,
              pageNumber: f.page_number,
              x: f.x,
              y: f.y,
              fontSize: f.font_size,
              displayOrder: f.display_order,
            }))}
          initialSignature={{
            pageNumber: template.signature_page,
            x: template.signature_x,
            y: template.signature_y,
            width: template.signature_width,
            height: template.signature_height,
          }}
          initialSeal={
            template.seal_page
              ? {
                  pageNumber: template.seal_page,
                  x: template.seal_x!,
                  y: template.seal_y!,
                  width: template.seal_width!,
                  height: template.seal_height!,
                }
              : null
          }
          initialDoctorSignature={
            template.doctor_signature_page
              ? {
                  pageNumber: template.doctor_signature_page,
                  x: template.doctor_signature_x!,
                  y: template.doctor_signature_y!,
                  width: template.doctor_signature_width!,
                  height: template.doctor_signature_height!,
                }
              : null
          }
        />
      </div>
    </main>
  );
}
