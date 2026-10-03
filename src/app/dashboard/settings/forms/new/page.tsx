import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { NewFormTemplateForm } from "./new-form-template-form";

export const metadata: Metadata = { title: "New form template — ClinicOS" };

export default function NewFormTemplatePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard/settings/forms" label="Forms" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">New form template</h1>
      <div className="mt-8">
        <NewFormTemplateForm />
      </div>
    </main>
  );
}
