"use client";

import { useState } from "react";
import { PdfCanvas, pdfPointToCanvasPixel, type PdfPageInfo, type PdfPoint } from "./pdf-canvas";
import type { FormFieldInputType } from "@/types/database";
import type {
  FormTemplateFieldInput,
  SignatureBoxInput,
  SealBoxInput,
  DoctorSignatureBoxInput,
} from "@/app/dashboard/settings/forms/actions";
import {
  PATIENT_FIELD_OPTIONS,
  HOSPITAL_FIELD_OPTIONS,
  DOCTOR_FIELD_OPTIONS,
  OTHER_FIELD_OPTIONS,
} from "@/lib/documents/form-field-sources";

const CUSTOM_SOURCE = "custom";
const KNOWN_FIELD_OPTIONS = [
  ...PATIENT_FIELD_OPTIONS,
  ...HOSPITAL_FIELD_OPTIONS,
  ...DOCTOR_FIELD_OPTIONS,
  ...OTHER_FIELD_OPTIONS,
];
// Sources whose value is inherently a date -- picking one should set
// the field's Type to "date" too, not leave it defaulted to Text.
const DATE_SOURCE_KEYS: readonly string[] = ["system.today"];

/**
 * A known source (e.g. "Today's date") can legitimately be placed
 * more than once on the same form -- once near the patient's
 * signature, once near the doctor's. field_key must stay unique per
 * template (db constraint), so a repeat gets a disambiguating "#2",
 * "#3", ... suffix automatically; resolveKnownFieldValue strips it
 * back off before resolving the value, so both copies still auto-fill
 * identically. The visible Label stays freely editable so staff can
 * still tell the two apart on the fill screen.
 */
function uniqueFieldKey(baseKey: string, existing: FormTemplateFieldInput[]): string {
  if (!existing.some((f) => f.fieldKey === baseKey)) return baseKey;
  let n = 2;
  while (existing.some((f) => f.fieldKey === `${baseKey}#${n}`)) n++;
  return `${baseKey}#${n}`;
}

const CANVAS_WIDTH_PX = 800;
const INPUT_TYPE_LABELS: Record<FormFieldInputType, string> = {
  text: "Text",
  date: "Date",
  textarea: "Long text",
};

export interface FormLayout {
  fields: FormTemplateFieldInput[];
  signature: SignatureBoxInput | null;
  seal: SealBoxInput | null;
  doctorSignature: DoctorSignatureBoxInput | null;
}

/**
 * Click-to-place designer for a form template: click the real
 * uploaded PDF where a field belongs, name it, repeat; one more click
 * places the (single, special-cased) signature box. Reports the whole
 * layout back to the parent on every change, so the parent's create
 * form can submit it as one JSON blob alongside the file.
 *
 * `file` accepts a fresh upload (File, the create flow) or a signed
 * URL to an already-uploaded blank PDF (string, the edit flow) --
 * PdfCanvas already supports both. `initialFields`/`initialSignature`/
 * `initialSeal` seed the designer's state for editing an existing
 * template's field positions without re-uploading the PDF.
 */
export function FormTemplateDesigner({
  file,
  onLayoutChange,
  initialFields,
  initialSignature = null,
  initialSeal = null,
  initialDoctorSignature = null,
}: {
  file: File | string;
  onLayoutChange: (layout: FormLayout) => void;
  initialFields?: FormTemplateFieldInput[];
  initialSignature?: SignatureBoxInput | null;
  initialSeal?: SealBoxInput | null;
  initialDoctorSignature?: DoctorSignatureBoxInput | null;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInfo, setPageInfo] = useState<PdfPageInfo | null>(null);
  const [fields, setFields] = useState<FormTemplateFieldInput[]>(initialFields ?? []);
  const [signature, setSignature] = useState<SignatureBoxInput | null>(initialSignature);
  const [seal, setSeal] = useState<SealBoxInput | null>(initialSeal);
  const [doctorSignature, setDoctorSignature] = useState<DoctorSignatureBoxInput | null>(
    initialDoctorSignature,
  );
  const [mode, setMode] = useState<"field" | "signature" | "seal" | "doctorSignature" | null>(null);
  const [pendingClick, setPendingClick] = useState<PdfPoint | null>(null);
  const [pendingSource, setPendingSource] = useState<string>(CUSTOM_SOURCE);
  const [pendingKey, setPendingKey] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [pendingType, setPendingType] = useState<FormFieldInputType>("text");

  function selectSource(value: string) {
    setPendingSource(value);
    if (value === CUSTOM_SOURCE) {
      setPendingKey("");
      setPendingLabel("");
      return;
    }
    const option = KNOWN_FIELD_OPTIONS.find((o) => o.key === value);
    if (option) {
      setPendingKey(option.key);
      setPendingLabel(option.label);
      setPendingType(DATE_SOURCE_KEYS.includes(option.key) ? "date" : "text");
    }
  }

  function emit(
    nextFields: FormTemplateFieldInput[],
    nextSignature: SignatureBoxInput | null,
    nextSeal: SealBoxInput | null,
    nextDoctorSignature: DoctorSignatureBoxInput | null,
  ) {
    onLayoutChange({
      fields: nextFields,
      signature: nextSignature,
      seal: nextSeal,
      doctorSignature: nextDoctorSignature,
    });
  }

  function handleClickAt(point: PdfPoint) {
    if (mode === "signature") {
      const box: SignatureBoxInput = {
        pageNumber,
        x: point.xPt,
        y: point.yPt,
        width: 160,
        height: 50,
      };
      setSignature(box);
      emit(fields, box, seal, doctorSignature);
      setMode(null);
      return;
    }
    if (mode === "seal") {
      const box: SealBoxInput = { pageNumber, x: point.xPt, y: point.yPt, width: 120, height: 60 };
      setSeal(box);
      emit(fields, signature, box, doctorSignature);
      setMode(null);
      return;
    }
    if (mode === "doctorSignature") {
      const box: DoctorSignatureBoxInput = {
        pageNumber,
        x: point.xPt,
        y: point.yPt,
        width: 160,
        height: 50,
      };
      setDoctorSignature(box);
      emit(fields, signature, seal, box);
      setMode(null);
      return;
    }
    if (mode === "field") {
      setPendingClick(point);
    }
  }

  function confirmField() {
    if (!pendingClick || !pendingKey.trim() || !pendingLabel.trim()) return;
    const fieldKey =
      pendingSource === CUSTOM_SOURCE
        ? pendingKey.trim()
        : uniqueFieldKey(pendingKey.trim(), fields);
    const next = [
      ...fields,
      {
        fieldKey,
        label: pendingLabel.trim(),
        inputType: pendingType,
        pageNumber,
        x: pendingClick.xPt,
        y: pendingClick.yPt,
        fontSize: 11,
        displayOrder: fields.length,
      },
    ];
    setFields(next);
    emit(next, signature, seal, doctorSignature);
    cancelPendingField();
  }

  function cancelPendingField() {
    setPendingClick(null);
    setPendingSource(CUSTOM_SOURCE);
    setPendingKey("");
    setPendingLabel("");
    setPendingType("text");
    setMode(null);
  }

  function removeField(index: number) {
    const next = fields.filter((_, i) => i !== index);
    setFields(next);
    emit(next, signature, seal, doctorSignature);
  }

  function removeSignature() {
    setSignature(null);
    emit(fields, null, seal, doctorSignature);
  }

  function removeSeal() {
    setSeal(null);
    emit(fields, signature, null, doctorSignature);
  }

  function removeDoctorSignature() {
    setDoctorSignature(null);
    emit(fields, signature, seal, null);
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-col gap-2">
        {pageInfo && pageInfo.pageCount > 1 ? (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="designer-page" className="font-medium">
              Page
            </label>
            <select
              id="designer-page"
              value={pageNumber}
              onChange={(e) => {
                setPageNumber(Number(e.target.value));
                cancelPendingField();
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
            >
              {Array.from({ length: pageInfo.pageCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <PdfCanvas
          source={file}
          pageNumber={pageNumber}
          onLoaded={setPageInfo}
          onClickAt={handleClickAt}
        >
          {pageInfo
            ? (() => {
                // The canvas is only ever rendered at min(1, CANVAS_WIDTH_PX / pageWidthPt)
                // scale (see PdfCanvas) -- this is its actual on-screen
                // width, which pdfPointToCanvasPixel needs to convert a
                // stored PDF-point position back to a pixel offset.
                const renderedWidthPx =
                  pageInfo.pageWidthPt * Math.min(1, CANVAS_WIDTH_PX / pageInfo.pageWidthPt);
                return (
                  <>
                    {fields
                      .filter((f) => f.pageNumber === pageNumber)
                      .map((f, i) => {
                        const pos = pdfPointToCanvasPixel(f, pageInfo, renderedWidthPx);
                        return (
                          <span
                            key={i}
                            className="pointer-events-none absolute -translate-y-full rounded bg-teal-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white"
                            style={{ left: pos.left, top: pos.top }}
                          >
                            {f.label}
                          </span>
                        );
                      })}
                    {signature && signature.pageNumber === pageNumber
                      ? (() => {
                          const pos = pdfPointToCanvasPixel(signature, pageInfo, renderedWidthPx);
                          return (
                            <span
                              className="pointer-events-none absolute -translate-y-full rounded bg-amber-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white"
                              style={{ left: pos.left, top: pos.top }}
                            >
                              Signature
                            </span>
                          );
                        })()
                      : null}
                    {seal && seal.pageNumber === pageNumber
                      ? (() => {
                          const pos = pdfPointToCanvasPixel(seal, pageInfo, renderedWidthPx);
                          return (
                            <span
                              className="pointer-events-none absolute -translate-y-full rounded bg-purple-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white"
                              style={{ left: pos.left, top: pos.top }}
                            >
                              Seal
                            </span>
                          );
                        })()
                      : null}
                    {doctorSignature && doctorSignature.pageNumber === pageNumber
                      ? (() => {
                          const pos = pdfPointToCanvasPixel(
                            doctorSignature,
                            pageInfo,
                            renderedWidthPx,
                          );
                          return (
                            <span
                              className="pointer-events-none absolute -translate-y-full rounded bg-blue-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white"
                              style={{ left: pos.left, top: pos.top }}
                            >
                              Doctor&apos;s signature
                            </span>
                          );
                        })()
                      : null}
                  </>
                );
              })()
            : null}
        </PdfCanvas>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              cancelPendingField();
              setMode(mode === "field" ? null : "field");
            }}
            className={
              mode === "field"
                ? "rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            }
          >
            {mode === "field" ? "Click the form to place a field…" : "+ Place a field"}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelPendingField();
              setMode(mode === "signature" ? null : "signature");
            }}
            className={
              mode === "signature"
                ? "rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            }
          >
            {mode === "signature"
              ? "Click the form to place the signature…"
              : "+ Place signature box"}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelPendingField();
              setMode(mode === "seal" ? null : "seal");
            }}
            className={
              mode === "seal"
                ? "rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            }
          >
            {mode === "seal" ? "Click the form to place the seal…" : "+ Place seal (optional)"}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelPendingField();
              setMode(mode === "doctorSignature" ? null : "doctorSignature");
            }}
            className={
              mode === "doctorSignature"
                ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            }
          >
            {mode === "doctorSignature"
              ? "Click the form to place the doctor's signature…"
              : "+ Place doctor's signature (optional)"}
          </button>
        </div>

        {pendingClick ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-teal-300 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950">
            <div className="flex flex-col gap-1">
              <label htmlFor="pending-source" className="text-xs font-medium">
                Source
              </label>
              <select
                id="pending-source"
                value={pendingSource}
                onChange={(e) => selectSource(e.target.value)}
                className="w-52 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
              >
                <option value={CUSTOM_SOURCE}>Typed fresh each visit</option>
                <optgroup label="Patient">
                  {PATIENT_FIELD_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Hospital">
                  {HOSPITAL_FIELD_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Doctor">
                  {DOCTOR_FIELD_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other">
                  {OTHER_FIELD_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            {pendingSource === CUSTOM_SOURCE ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="pending-key" className="text-xs font-medium">
                  Field key
                </label>
                <input
                  id="pending-key"
                  value={pendingKey}
                  onChange={(e) => setPendingKey(e.target.value)}
                  placeholder="referring_doctor"
                  className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor="pending-label" className="text-xs font-medium">
                Label shown to staff
              </label>
              <input
                id="pending-label"
                value={pendingLabel}
                onChange={(e) => setPendingLabel(e.target.value)}
                placeholder="Patient name"
                className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pending-type" className="text-xs font-medium">
                Type
              </label>
              <select
                id="pending-type"
                value={pendingType}
                onChange={(e) => setPendingType(e.target.value as FormFieldInputType)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
              >
                {Object.entries(INPUT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={confirmField}
              disabled={!pendingKey.trim() || !pendingLabel.trim()}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              Add
            </button>
            <button
              type="button"
              onClick={cancelPendingField}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-56 flex-col gap-2">
        <p className="text-sm font-medium">Fields placed</p>
        {fields.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {fields.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>
                  {f.label} <span className="text-zinc-400">(p{f.pageNumber})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  className="text-xs text-red-600 underline dark:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-sm font-medium">Signature</p>
        {signature ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Page {signature.pageNumber}, ({Math.round(signature.x)}, {Math.round(signature.y)})
            </span>
            <button
              type="button"
              onClick={removeSignature}
              className="text-xs text-red-600 underline dark:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Not placed yet.</p>
        )}

        <p className="mt-3 text-sm font-medium">Seal (optional)</p>
        {seal ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Page {seal.pageNumber}, ({Math.round(seal.x)}, {Math.round(seal.y)})
            </span>
            <button
              type="button"
              onClick={removeSeal}
              className="text-xs text-red-600 underline dark:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Not placed.</p>
        )}

        <p className="mt-3 text-sm font-medium">Doctor&apos;s signature (optional)</p>
        {doctorSignature ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Page {doctorSignature.pageNumber}, ({Math.round(doctorSignature.x)},{" "}
              {Math.round(doctorSignature.y)})
            </span>
            <button
              type="button"
              onClick={removeDoctorSignature}
              className="text-xs text-red-600 underline dark:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Not placed.</p>
        )}
      </div>
    </div>
  );
}
