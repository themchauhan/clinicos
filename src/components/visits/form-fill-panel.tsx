"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PdfCanvas } from "@/components/settings/forms/pdf-canvas";
import { SignaturePad } from "@/components/scans/signature-pad";
import { getFormTemplateViewUrl, submitFilledForm } from "@/app/dashboard/visits/form-actions";
import {
  createFormSignSession,
  getScanSessionStatus,
  type CreateScanSessionResult,
} from "@/app/dashboard/scans/actions";
import type { PairedDeviceInfo } from "@/app/dashboard/devices/actions";
import type { FormFieldInputType } from "@/types/database";
import {
  resolveKnownFieldValue,
  type PatientFieldSource,
  type HospitalFieldSource,
  type DoctorFieldSource,
  type VisitFieldSource,
} from "@/lib/documents/form-field-sources";
import { formatChecklistValue, getChecklist, selectedCodes } from "@/lib/documents/checklists";

const POLL_INTERVAL_MS = 2500;

export interface FormTemplateOption {
  id: string;
  name: string;
  description: string | null;
}

/** Where a form stands on this visit: `required` is null when the visit
 * type has no rule for it; `signed` when a filled copy is already attached. */
export interface FormStatus {
  required: boolean | null;
  signed: boolean;
}

export interface FormTemplateFieldOption {
  fieldKey: string;
  label: string;
  inputType: FormFieldInputType;
  /** For a checklist field: which built-in list it offers. */
  checklistKey?: string | null;
  displayOrder: number;
}

/**
 * Fills a form template's fields for this visit/patient, shows the
 * real uploaded form for context, then captures a signature -- the
 * server flattens both directly onto the real PDF (form-actions.ts),
 * so the saved record looks like a genuinely filled copy of it.
 */
export function FormFillPanel({
  templates,
  fieldsByTemplate,
  patientId,
  visitId,
  patient,
  hospital,
  doctor,
  visit = null,
  revalidate,
  pairedDevice,
  statusByTemplate = {},
  hint = null,
}: {
  templates: FormTemplateOption[];
  fieldsByTemplate: Record<string, FormTemplateFieldOption[]>;
  patientId: string;
  visitId?: string;
  patient: PatientFieldSource;
  hospital: HospitalFieldSource;
  doctor: DoctorFieldSource;
  /** The visit being filled for -- source of the procedure date, type, referrer, LMP. */
  visit?: VisitFieldSource | null;
  revalidate: string;
  pairedDevice: PairedDeviceInfo | null;
  statusByTemplate?: Record<string, FormStatus>;
  /** Soft, dismissible-by-ignoring nudge shown above the list. */
  hint?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"fill" | "sign">("fill");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remote/connected-device signing (mirrors DocumentUploadPanel's
  // handleStart + status-polling exactly, for the same phone-scan
  // session machinery -- just carrying a form template instead of a
  // document type).
  const [remoteSession, setRemoteSession] = useState<CreateScanSessionResult | null>(null);
  const [remoteDone, setRemoteDone] = useState(false);
  const [remoteStarting, setRemoteStarting] = useState(false);
  const deviceIsConnected = Boolean(pairedDevice?.confirmedAt);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const fields = selectedId ? (fieldsByTemplate[selectedId] ?? []) : [];

  useEffect(() => {
    if (!remoteSession || remoteDone) return;
    const interval = setInterval(async () => {
      const result = await getScanSessionStatus(remoteSession.sessionId);
      if ("error" in result) return;
      if (result.status === "COMPLETED") {
        setRemoteDone(true);
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [remoteSession, remoteDone, router]);

  async function handleSendToPhone(useConnectedDevice: boolean) {
    if (!selectedId) return;
    setError(null);
    setRemoteStarting(true);
    const result = await createFormSignSession({
      patientId,
      visitId,
      formTemplateId: selectedId,
      fieldValues: values,
      pairedDeviceId: useConnectedDevice && pairedDevice ? pairedDevice.id : undefined,
    });
    setRemoteStarting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRemoteDone(false);
    setRemoteSession(result);
  }

  function selectTemplate(templateId: string) {
    const templateFields = fieldsByTemplate[templateId] ?? [];
    setSelectedId(templateId);
    setValues(
      Object.fromEntries(
        templateFields.map((f) => [
          f.fieldKey,
          resolveKnownFieldValue(f.fieldKey, { patient, hospital, doctor, visit }) ?? "",
        ]),
      ),
    );
    setStep("fill");
    setError(null);
    setPdfUrl(null);
    void getFormTemplateViewUrl(templateId).then((result) => {
      if ("url" in result) setPdfUrl(result.url);
    });
  }

  function reset() {
    setSelectedId(null);
    setPdfUrl(null);
    setValues({});
    setStep("fill");
    setShowReference(false);
    setRemoteSession(null);
    setRemoteDone(false);
    setError(null);
  }

  async function handleSign(signatureDataUrl: string) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    const result = await submitFilledForm(
      { patientId, visitId, formTemplateId: selectedId, revalidate },
      values,
      signatureDataUrl,
    );
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    reset();
    router.refresh();
  }

  if (templates.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {!selected ? (
        <FormList
          templates={templates}
          statusByTemplate={statusByTemplate}
          hint={hint}
          onFill={selectTemplate}
        />
      ) : (
        <div className="flex flex-col gap-4 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <p className="font-medium">{selected.name}</p>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400"
            >
              Cancel
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowReference((v) => !v)}
              className="inline-flex items-center gap-1 text-sm text-teal-700 underline hover:text-teal-800"
            >
              {showReference ? "Hide" : "Show"} the blank form for reference
            </button>
            {showReference ? (
              <div className="mt-2 max-w-full overflow-auto">
                {pdfUrl ? (
                  <PdfCanvas source={pdfUrl} pageNumber={1} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading the form…</p>
                )}
              </div>
            ) : null}
          </div>

          {step === "fill" ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Fill in the details below, then continue to have the patient sign.
              </p>
              <div className="flex flex-col gap-3">
                {fields
                  .slice()
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((f) => (
                    <div key={f.fieldKey} className="flex flex-col gap-1.5">
                      <label htmlFor={`field-${f.fieldKey}`} className="text-sm font-medium">
                        {f.label}
                      </label>
                      {f.inputType === "tick" ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            id={`field-${f.fieldKey}`}
                            type="checkbox"
                            checked={isTicked(values[f.fieldKey] ?? "")}
                            onChange={(e) =>
                              setValues((prev) => ({
                                ...prev,
                                [f.fieldKey]: e.target.checked ? "1" : "",
                              }))
                            }
                          />
                          Tick
                        </label>
                      ) : f.inputType === "checklist" ? (
                        <ChecklistInput
                          id={`field-${f.fieldKey}`}
                          checklistKey={f.checklistKey ?? null}
                          value={values[f.fieldKey] ?? ""}
                          onChange={(next) =>
                            setValues((prev) => ({ ...prev, [f.fieldKey]: next }))
                          }
                        />
                      ) : f.inputType === "textarea" ? (
                        <textarea
                          id={`field-${f.fieldKey}`}
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [f.fieldKey]: e.target.value }))
                          }
                          rows={2}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
                        />
                      ) : (
                        <input
                          id={`field-${f.fieldKey}`}
                          type={f.inputType === "date" ? "date" : "text"}
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [f.fieldKey]: e.target.value }))
                          }
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
                        />
                      )}
                    </div>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => setStep("sign")}
                className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
              >
                Continue to sign
              </button>
            </>
          ) : (
            <>
              <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                <p className="font-medium">Please review before signing:</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {fields.map((f) => (
                    <span key={f.fieldKey} className="contents">
                      <dt className="text-zinc-500 dark:text-zinc-400">{f.label}</dt>
                      <dd>{reviewText(f, values[f.fieldKey] ?? "")}</dd>
                    </span>
                  ))}
                </dl>
              </div>
              {remoteSession ? (
                remoteSession.pairedDevice ? (
                  <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
                    <p className="font-medium">Sign on phone</p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {remoteDone
                        ? "Signature captured."
                        : "Sent to your connected device — waiting…"}
                    </p>
                    <button
                      type="button"
                      onClick={() => (remoteDone ? reset() : setRemoteSession(null))}
                      className="text-sm text-teal-700 underline hover:text-teal-800"
                    >
                      {remoteDone ? "Fill another form" : "Cancel"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
                    <p className="font-medium">Sign on phone</p>
                    {!remoteDone ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- qrDataUrl
                            is a data: URI generated per-session, not a static asset
                            next/image can optimize. */}
                        <img
                          src={remoteSession.qrDataUrl}
                          alt="QR code to open the signing page on a phone"
                          width={180}
                          height={180}
                          className="rounded-md border border-slate-200 bg-white p-2"
                        />
                        <p className="text-zinc-500 dark:text-zinc-400">
                          Already on the phone or tablet? Open it directly instead of scanning:
                        </p>
                        <a
                          href={remoteSession.scanUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        >
                          Open to sign
                        </a>
                        <p className="text-zinc-500 dark:text-zinc-400">Waiting for signature…</p>
                      </>
                    ) : (
                      <p className="text-zinc-500 dark:text-zinc-400">Signature captured.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => (remoteDone ? reset() : setRemoteSession(null))}
                      className="text-sm text-teal-700 underline hover:text-teal-800"
                    >
                      {remoteDone ? "Fill another form" : "Cancel"}
                    </button>
                  </div>
                )
              ) : (
                <>
                  <SignaturePad
                    declarationText={selected.description}
                    busy={busy}
                    onSubmit={handleSign}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <button
                      type="button"
                      onClick={() => handleSendToPhone(true)}
                      disabled={remoteStarting}
                      className="underline hover:text-zinc-700 disabled:opacity-60"
                    >
                      {remoteStarting ? "Starting…" : "Sign on the clinic's device instead"}
                    </button>
                    {deviceIsConnected ? (
                      <>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => handleSendToPhone(false)}
                          disabled={remoteStarting}
                          className="underline hover:text-zinc-700 disabled:opacity-60"
                        >
                          Use a QR instead
                        </button>
                        <span>·</span>
                        <Link href="/dashboard/devices" className="underline hover:text-zinc-700">
                          Manage connected device
                        </Link>
                      </>
                    ) : null}
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setStep("fill")}
                className="w-fit text-sm text-teal-700 underline hover:text-teal-800"
              >
                Back to editing
              </button>
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The "Forms for this visit" list: required forms first with their
 * status, everything else tucked under "Other forms" (open when a hint
 * says forms are probably needed anyway). */
function FormList({
  templates,
  statusByTemplate,
  hint,
  onFill,
}: {
  templates: FormTemplateOption[];
  statusByTemplate: Record<string, FormStatus>;
  hint: string | null;
  onFill: (templateId: string) => void;
}) {
  const relevant = templates.filter((t) => statusByTemplate[t.id]?.required != null);
  const others = templates.filter((t) => statusByTemplate[t.id]?.required == null);

  return (
    <div className="flex flex-col gap-3">
      {hint ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {hint}
        </p>
      ) : null}

      {relevant.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {relevant.map((t) => (
            <FormItem key={t.id} template={t} status={statusByTemplate[t.id]!} onFill={onFill} />
          ))}
        </ul>
      ) : null}

      {others.length > 0 ? (
        <details open={Boolean(hint) || relevant.length === 0} className="group">
          <summary className="cursor-pointer text-sm text-zinc-600 select-none dark:text-zinc-400">
            {relevant.length > 0 ? "Other forms" : "Forms"} ({others.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((t) => (
              <FormItem
                key={t.id}
                template={t}
                status={statusByTemplate[t.id] ?? { required: null, signed: false }}
                onFill={onFill}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function FormItem({
  template,
  status,
  onFill,
}: {
  template: FormTemplateOption;
  status: FormStatus;
  onFill: (templateId: string) => void;
}) {
  const badge = status.signed
    ? { text: "Signed ✓", cls: "text-emerald-700 dark:text-emerald-400" }
    : status.required
      ? { text: "Required — not filled", cls: "text-amber-700 dark:text-amber-400" }
      : { text: "Not filled", cls: "text-zinc-500 dark:text-zinc-400" };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div>
        <p className="text-sm font-medium">{template.name}</p>
        <p className={`text-xs ${badge.cls}`}>{badge.text}</p>
      </div>
      <button
        type="button"
        onClick={() => onFill(template.id)}
        className={
          status.signed
            ? "rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            : "rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        }
      >
        {status.signed ? "Fill again" : "Fill & sign"}
      </button>
    </li>
  );
}

function isTicked(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
}

/** How a field's value reads on the "review before signing" screen. */
function reviewText(field: FormTemplateFieldOption, value: string): string {
  if (field.inputType === "tick") return isTicked(value) ? "Ticked" : "—";
  if (field.inputType === "checklist") {
    const list = getChecklist(field.checklistKey);
    return (list ? formatChecklistValue(value, list) : value) || "—";
  }
  return value || "—";
}

/** A pick-list shown as checkboxes: the chosen codes are stored as "ii,xvii". */
function ChecklistInput({
  id,
  checklistKey,
  value,
  onChange,
}: {
  id: string;
  checklistKey: string | null;
  value: string;
  onChange: (next: string) => void;
}) {
  const list = getChecklist(checklistKey);
  if (!list) {
    return <p className="text-sm text-red-600">This field&rsquo;s list is missing.</p>;
  }
  const chosen = new Set(selectedCodes(value, list));
  const toggle = (code: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(code);
    else next.delete(code);
    onChange(
      list.items
        .map((i) => i.code)
        .filter((c) => next.has(c))
        .join(","),
    );
  };
  return (
    <details className="rounded-md border border-slate-300 bg-white" open={chosen.size > 0}>
      <summary className="cursor-pointer px-3 py-2 text-sm select-none">
        {chosen.size > 0 ? `Selected: ${formatChecklistValue(value, list)}` : "Choose…"}
      </summary>
      <ul id={id} className="flex flex-col gap-1.5 border-t border-slate-200 px-3 py-2 text-sm">
        {list.items.map((item) => (
          <li key={item.code}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={chosen.has(item.code)}
                onChange={(e) => toggle(item.code, e.target.checked)}
              />
              <span>
                <span className="font-medium">{item.code}.</span> {item.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
