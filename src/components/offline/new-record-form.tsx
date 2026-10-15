"use client";

import { useState } from "react";
import type { OfflineSession } from "@/lib/offline/session";
import { enqueueRegistration, findLookalike, istDate, OfflineSaveError } from "@/lib/offline/queue";
import type { LocalOp } from "@/lib/offline/db";
import { parsePatientFields } from "@/lib/patients/parse";
import { validateLmp } from "@/lib/visits/lmp";
import { asksPregnancyDetails } from "@/lib/patients/gender";
import { GUARDIAN_RELATIONS } from "@/lib/patients/guardian";

const INPUT =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 disabled:bg-slate-50";

type Values = Record<string, string>;

/**
 * Register a patient and start a visit while offline. The record is checked
 * with the SAME rules as the online form, then saved to this computer in one
 * durable, verified step. "Saved" is shown only after that step has finished;
 * if it fails, the person is told nothing was saved. A second tap on Save can
 * never create a second record: the button locks, and a record that looks like
 * one already saved here asks first.
 */
export function NewRecordForm({
  session,
  disabled,
  onCancel,
  onSaved,
}: {
  session: OfflineSession;
  disabled: boolean;
  onCancel: () => void;
  onSaved: (op: LocalOp) => void;
}) {
  const [v, setV] = useState<Values>({ gender: "", feeAmount: "0" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookalike, setLookalike] = useState<LocalOp | null>(null);

  const set = (name: string, value: string) => {
    setLookalike(null);
    setV((prev) => ({ ...prev, [name]: value }));
  };
  const field = (name: string) => v[name] ?? "";

  const visitType = session.visit_types.find((t) => t.id === v.visitTypeId);
  const showChildren = asksPregnancyDetails(field("gender") === "MALE" ? "MALE" : null);
  const showLmp = visitType?.module === "USG" && showChildren;

  function chooseVisitType(id: string) {
    const t = session.visit_types.find((x) => x.id === id);
    setV((prev) => ({
      ...prev,
      visitTypeId: id,
      feeAmount: t?.default_fee != null ? String(t.default_fee) : prev.feeAmount,
    }));
  }

  async function submit(e: React.FormEvent, confirmedAnother = false) {
    e.preventDefault();
    if (saving || disabled) return;
    setError(null);

    const patient = parsePatientFields((k) => field(k));
    if ("error" in patient) return setError(patient.error);
    if (!v.visitTypeId) return setError("Choose a visit type.");
    const fee = field("feeAmount").trim() === "" ? 0 : Number(field("feeAmount"));
    if (Number.isNaN(fee) || fee < 0) return setError("Fee must be a positive number.");
    const lmp = validateLmp(showLmp ? field("lmpDate") : "", istDate(Date.now()));
    if ("error" in lmp) return setError(lmp.error);

    setSaving(true);
    try {
      if (!confirmedAnother) {
        const existing = await findLookalike(session.scope, patient);
        if (existing) {
          setLookalike(existing);
          return;
        }
      }
      const op = await enqueueRegistration(session.scope, {
        patient,
        visit: {
          visitTypeId: v.visitTypeId,
          doctorId: field("doctorId") || null,
          notes: field("notes").trim() || null,
          referredByName: field("referredByName").trim() || null,
          referredByHospital: field("referredByHospital").trim() || null,
          feeAmount: fee,
          followUpDate: field("followUpDate") || null,
          lmpDate: lmp.value,
        },
      });
      onSaved(op);
    } catch (err) {
      setError(
        err instanceof OfflineSaveError
          ? err.message
          : "Could not save on this computer. Nothing was saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden"
    >
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-6">
        <Box span="sm:col-span-3" label="Name" required>
          <input
            id="o-name"
            className={INPUT}
            value={field("name")}
            onChange={(e) => set("name", e.target.value)}
            autoFocus
            required
          />
        </Box>
        <Box span="sm:col-span-3" label="Mobile">
          <input
            id="o-mobile"
            className={INPUT}
            type="tel"
            inputMode="tel"
            value={field("mobile")}
            onChange={(e) => set("mobile", e.target.value)}
            placeholder="e.g. 9876543210"
          />
        </Box>
        <fieldset className="flex flex-col gap-1.5 sm:col-span-6">
          <legend className="mb-1.5 text-sm font-medium">Gender</legend>
          <div className="flex w-fit overflow-hidden rounded-md border border-slate-300">
            {(["FEMALE", "MALE", "OTHER"] as const).map((g) => (
              <label
                key={g}
                className="cursor-pointer border-r border-slate-300 px-4 py-2 text-sm last:border-r-0 has-checked:bg-teal-600 has-checked:text-white"
              >
                <input
                  type="radio"
                  name="o-gender"
                  className="sr-only"
                  checked={field("gender") === g}
                  onChange={() => set("gender", g)}
                />
                {g === "FEMALE" ? "Female" : g === "MALE" ? "Male" : "Other"}
              </label>
            ))}
          </div>
        </fieldset>
        <Box span="sm:col-span-3" label="Date of birth">
          <input
            id="o-dob"
            className={INPUT}
            type="date"
            value={field("dob")}
            onChange={(e) => set("dob", e.target.value)}
          />
        </Box>
        <Box span="sm:col-span-3" label="Approx. age (years)">
          <input
            id="o-age"
            className={INPUT}
            type="number"
            min={0}
            disabled={Boolean(field("dob"))}
            value={field("approximateAgeYears")}
            onChange={(e) => set("approximateAgeYears", e.target.value)}
            placeholder="If DOB unknown"
          />
        </Box>
        <Box span="sm:col-span-2" label="Relationship">
          <select
            id="o-rel"
            className={INPUT}
            value={field("guardianRelation")}
            onChange={(e) => set("guardianRelation", e.target.value)}
          >
            <option value="">Not specified</option>
            {GUARDIAN_RELATIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Box>
        <Box span="sm:col-span-4" label="Guardian name">
          <input
            id="o-guardian"
            className={INPUT}
            value={field("guardianName")}
            onChange={(e) => set("guardianName", e.target.value)}
          />
        </Box>
        <Box span="sm:col-span-6" label="Address">
          <textarea
            id="o-address"
            className={INPUT}
            rows={2}
            value={field("address")}
            onChange={(e) => set("address", e.target.value)}
          />
        </Box>
        {showChildren ? (
          <>
            <Box span="sm:col-span-2" label="Living sons">
              <input
                className={INPUT}
                type="number"
                min={0}
                value={field("livingSons")}
                onChange={(e) => set("livingSons", e.target.value)}
              />
            </Box>
            <Box span="sm:col-span-4" label="Age of each son">
              <input
                className={INPUT}
                value={field("livingSonsAges")}
                onChange={(e) => set("livingSonsAges", e.target.value)}
              />
            </Box>
            <Box span="sm:col-span-2" label="Living daughters">
              <input
                className={INPUT}
                type="number"
                min={0}
                value={field("livingDaughters")}
                onChange={(e) => set("livingDaughters", e.target.value)}
              />
            </Box>
            <Box span="sm:col-span-4" label="Age of each daughter">
              <input
                className={INPUT}
                value={field("livingDaughtersAges")}
                onChange={(e) => set("livingDaughtersAges", e.target.value)}
              />
            </Box>
          </>
        ) : null}

        <Box span="sm:col-span-2" label="Visit type" required>
          <select
            id="o-vtype"
            className={INPUT}
            value={field("visitTypeId")}
            onChange={(e) => chooseVisitType(e.target.value)}
            required
          >
            <option value="">Choose a visit type</option>
            {session.visit_types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Box>
        <Box span="sm:col-span-2" label="Doctor">
          <select
            id="o-doctor"
            className={INPUT}
            value={field("doctorId")}
            onChange={(e) => set("doctorId", e.target.value)}
          >
            <option value="">Not specified</option>
            {session.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Box>
        <Box span="sm:col-span-2" label="Fee amount (₹)">
          <input
            id="o-fee"
            className={INPUT}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={field("feeAmount")}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => set("feeAmount", e.target.value)}
          />
        </Box>
        <Box span="sm:col-span-2" label="Referred by (doctor)">
          <input
            className={INPUT}
            value={field("referredByName")}
            onChange={(e) => set("referredByName", e.target.value)}
          />
        </Box>
        <Box span="sm:col-span-2" label="Referring hospital/clinic">
          <input
            className={INPUT}
            value={field("referredByHospital")}
            onChange={(e) => set("referredByHospital", e.target.value)}
          />
        </Box>
        {showLmp ? (
          <Box span="sm:col-span-2" label="Last menstrual period (LMP)">
            <input
              id="o-lmp"
              className={INPUT}
              type="date"
              value={field("lmpDate")}
              onChange={(e) => set("lmpDate", e.target.value)}
            />
          </Box>
        ) : null}
        <Box span="sm:col-span-6" label="Notes">
          <textarea
            className={INPUT}
            rows={2}
            value={field("notes")}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Box>
      </div>

      {lookalike ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p className="font-medium">
            This looks like someone already saved on this computer (no. {lookalike.label}).
          </p>
          <p className="mt-1">Save another record for them only if this is a different person.</p>
          <button
            type="button"
            disabled={saving}
            onClick={(e) => void submit(e as unknown as React.FormEvent, true)}
            className="mt-2 rounded-md border border-amber-700 px-3 py-1.5 hover:bg-amber-100"
          >
            This is a different person — save anyway
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
        <button
          type="submit"
          disabled={saving || disabled}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save on this computer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Box({
  label,
  span,
  required,
  children,
}: {
  label: string;
  span: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${span}`}>
      <span
        className={`text-sm font-medium${required ? "after:ml-0.5 after:text-red-500 after:content-['*']" : ""}`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
