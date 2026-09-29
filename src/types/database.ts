// Hand-authored to match supabase/migrations/*.sql. Regenerate with
// `npm run supabase -- gen types typescript --local > src/types/database.ts`
// once `supabase start` has been run, then diff against this file —
// the generated output is the source of truth from that point on.
//
// `Relationships` is required by @supabase/supabase-js's GenericTable
// shape. Tables with no embedded-resource query anywhere in the app
// keep it `[]` (structurally correct for "nothing to embed"); tables
// that ARE embedded (e.g. `.select("*, patients(...)")`) need a real
// entry matching the actual FK columns, or the embed doesn't type-check
// at all (falls back to a `SelectQueryError` type) — see visits/
// visit_payments below, which use the composite (foo_id, hospital_id)
// FKs from the Phase 2/3 migrations, not just a bare id column.

export type HospitalStatus = "TRIAL" | "ACTIVE" | "SUSPENDED" | "EXPIRED";
export type ModuleType = "GENERAL_OPD" | "USG";
export type StaffRole = "SUPER_ADMIN" | "HOSPITAL_ADMIN" | "RECEPTIONIST";
export type ProfileStatus = "ACTIVE" | "INACTIVE";
export type PatientGender = "MALE" | "FEMALE" | "OTHER";
export type VisitStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type PaymentMode = "CASH" | "UPI" | "CARD" | "OTHER";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type DocumentScope = "PATIENT" | "VISIT";
export type ScanSessionStatus = "PENDING" | "COMPLETED" | "CANCELLED";

export interface Database {
  public: {
    Tables: {
      hospitals: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          status: HospitalStatus;
          plan: string;
          trial_ends_at: string;
          subscription_ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["hospitals"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["hospitals"]["Row"]>;
        Relationships: [];
      };
      hospital_modules: {
        Row: {
          id: string;
          hospital_id: string;
          module: ModuleType;
          enabled_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["hospital_modules"]["Row"]> & {
          hospital_id: string;
          module: ModuleType;
        };
        Update: Partial<Database["public"]["Tables"]["hospital_modules"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "hospital_modules_hospital_id_fkey";
            columns: ["hospital_id"];
            referencedRelation: "hospitals";
            referencedColumns: ["id"];
            isOneToOne: false;
          },
        ];
      };
      subscription_payments: {
        Row: {
          id: string;
          hospital_id: string;
          amount: number;
          payment_date: string;
          payment_method: string;
          reference_number: string | null;
          period_start: string;
          period_end: string;
          notes: string | null;
          is_reversal: boolean;
          recorded_by: string;
          created_at: string;
        };
        // recorded_by defaults to auth.uid() at the database level.
        Insert: Partial<Database["public"]["Tables"]["subscription_payments"]["Row"]> & {
          hospital_id: string;
          amount: number;
          payment_method: string;
          period_start: string;
          period_end: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscription_payments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "subscription_payments_hospital_id_fkey";
            columns: ["hospital_id"];
            referencedRelation: "hospitals";
            referencedColumns: ["id"];
            isOneToOne: false;
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          hospital_id: string | null;
          name: string;
          email: string;
          role: StaffRole;
          status: ProfileStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          name: string;
          email: string;
          role: StaffRole;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      platform_admins: {
        Row: {
          id: string;
          profile_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_admins"]["Row"]> & {
          profile_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_admins"]["Row"]>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          hospital_id: string | null;
          user_id: string;
          action: string;
          target_type: string;
          target_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        // user_id defaults to auth.uid() at the database level (see
        // the migration), so it's optional here too — but logAudit()
        // always sets it explicitly anyway.
        Insert: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]> & {
          action: string;
          target_type: string;
        };
        // Structurally typed for GenericTable's shape; RLS is what
        // actually forbids updates (no UPDATE policy exists at all).
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        Relationships: [];
      };
      patients: {
        Row: {
          id: string;
          hospital_id: string;
          patient_code: string;
          name: string;
          mobile: string | null;
          dob: string | null;
          approximate_age_years: number | null;
          guardian_name: string | null;
          gender: PatientGender | null;
          address: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        // hospital_id and patient_code both default at the database
        // level (see the migration), so neither is required here —
        // the app sets hospital_id explicitly anyway (hard rule #2).
        Insert: Partial<Database["public"]["Tables"]["patients"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Row"]>;
        Relationships: [];
      };
      patient_code_counters: {
        Row: { hospital_id: string; next_number: number };
        Insert: Partial<Database["public"]["Tables"]["patient_code_counters"]["Row"]> & {
          hospital_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["patient_code_counters"]["Row"]>;
        Relationships: [];
      };
      doctors: {
        Row: {
          id: string;
          hospital_id: string;
          name: string;
          profile_id: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["doctors"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["doctors"]["Row"]>;
        Relationships: [];
      };
      visit_types: {
        Row: {
          id: string;
          hospital_id: string;
          module: ModuleType;
          name: string;
          description: string | null;
          default_fee: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["visit_types"]["Row"]> & {
          module: ModuleType;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["visit_types"]["Row"]>;
        Relationships: [];
      };
      visit_counters: {
        Row: { hospital_id: string; next_number: number };
        Insert: Partial<Database["public"]["Tables"]["visit_counters"]["Row"]> & {
          hospital_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["visit_counters"]["Row"]>;
        Relationships: [];
      };
      visits: {
        Row: {
          id: string;
          hospital_id: string;
          visit_number: number;
          patient_id: string;
          visit_type_id: string;
          doctor_id: string | null;
          visit_date: string;
          notes: string | null;
          status: VisitStatus;
          fee_amount: number;
          follow_up_date: string | null;
          created_at: string;
          updated_at: string;
        };
        // hospital_id and visit_number both default at the database
        // level, so neither is required here (same as patients).
        Insert: Partial<Database["public"]["Tables"]["visits"]["Row"]> & {
          patient_id: string;
          visit_type_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["visits"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "visits_patient_id_hospital_id_fkey";
            columns: ["patient_id", "hospital_id"];
            referencedRelation: "patients";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "visits_visit_type_id_hospital_id_fkey";
            columns: ["visit_type_id", "hospital_id"];
            referencedRelation: "visit_types";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "visits_doctor_id_hospital_id_fkey";
            columns: ["doctor_id", "hospital_id"];
            referencedRelation: "doctors";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
        ];
      };
      visit_payments: {
        Row: {
          id: string;
          hospital_id: string;
          visit_id: string;
          amount: number;
          mode: PaymentMode;
          received_by: string;
          received_at: string;
          note: string | null;
          is_reversal: boolean;
          created_at: string;
        };
        // received_by defaults to auth.uid() at the database level.
        Insert: Partial<Database["public"]["Tables"]["visit_payments"]["Row"]> & {
          visit_id: string;
          amount: number;
          mode: PaymentMode;
        };
        Update: Partial<Database["public"]["Tables"]["visit_payments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "visit_payments_visit_id_hospital_id_fkey";
            columns: ["visit_id", "hospital_id"];
            referencedRelation: "visits";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "visit_payments_received_by_fkey";
            columns: ["received_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
            isOneToOne: false;
          },
        ];
      };
      document_types: {
        Row: {
          id: string;
          hospital_id: string;
          name: string;
          description: string | null;
          scope: DocumentScope;
          sensitive: boolean;
          active: boolean;
          version: number;
          effective_from: string;
          pc_pndt_form: boolean;
          requires_signature: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["document_types"]["Row"]> & {
          name: string;
          scope: DocumentScope;
        };
        Update: Partial<Database["public"]["Tables"]["document_types"]["Row"]>;
        Relationships: [];
      };
      visit_type_document_requirements: {
        Row: {
          id: string;
          hospital_id: string;
          visit_type_id: string;
          document_type_id: string;
          required: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["visit_type_document_requirements"]["Row"]> & {
          visit_type_id: string;
          document_type_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["visit_type_document_requirements"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "visit_type_document_requirements_visit_type_id_hospital_id_fkey";
            columns: ["visit_type_id", "hospital_id"];
            referencedRelation: "visit_types";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            // Postgres truncates identifiers past 63 bytes -- this is
            // the actual generated name, not "..._requirements_...".
            foreignKeyName: "visit_type_document_requireme_document_type_id_hospital_id_fkey";
            columns: ["document_type_id", "hospital_id"];
            referencedRelation: "document_types";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
        ];
      };
      visit_document_requirements: {
        Row: {
          id: string;
          hospital_id: string;
          visit_id: string;
          document_type_id: string;
          document_type_name: string;
          required: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["visit_document_requirements"]["Row"]> & {
          visit_id: string;
          document_type_id: string;
          document_type_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["visit_document_requirements"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "visit_document_requirements_visit_id_hospital_id_fkey";
            columns: ["visit_id", "hospital_id"];
            referencedRelation: "visits";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
        ];
      };
      documents: {
        Row: {
          id: string;
          hospital_id: string;
          patient_id: string;
          visit_id: string | null;
          document_type_id: string;
          file_name: string;
          file_type: string;
          storage_path: string;
          file_size: number;
          sha256: string;
          page_no: number | null;
          scan_session_id: string | null;
          uploaded_by: string;
          created_at: string;
          deleted_at: string | null;
        };
        // hospital_id and uploaded_by both default at the database level.
        Insert: Partial<Database["public"]["Tables"]["documents"]["Row"]> & {
          patient_id: string;
          document_type_id: string;
          file_name: string;
          file_type: string;
          storage_path: string;
          file_size: number;
          sha256: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "documents_patient_id_hospital_id_fkey";
            columns: ["patient_id", "hospital_id"];
            referencedRelation: "patients";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "documents_visit_id_hospital_id_fkey";
            columns: ["visit_id", "hospital_id"];
            referencedRelation: "visits";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "documents_document_type_id_hospital_id_fkey";
            columns: ["document_type_id", "hospital_id"];
            referencedRelation: "document_types";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "documents_scan_session_id_hospital_id_fkey";
            columns: ["scan_session_id", "hospital_id"];
            referencedRelation: "scan_sessions";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
        ];
      };
      scan_sessions: {
        Row: {
          id: string;
          hospital_id: string;
          created_by: string;
          patient_id: string;
          visit_id: string | null;
          document_type_id: string;
          token_hash: string;
          status: ScanSessionStatus;
          expires_at: string;
          completed_at: string | null;
          created_at: string;
          paired_device_id: string | null;
        };
        // hospital_id and created_by both default at the database level.
        Insert: Partial<Database["public"]["Tables"]["scan_sessions"]["Row"]> & {
          patient_id: string;
          document_type_id: string;
          token_hash: string;
        };
        Update: Partial<Database["public"]["Tables"]["scan_sessions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "scan_sessions_patient_id_hospital_id_fkey";
            columns: ["patient_id", "hospital_id"];
            referencedRelation: "patients";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "scan_sessions_visit_id_hospital_id_fkey";
            columns: ["visit_id", "hospital_id"];
            referencedRelation: "visits";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "scan_sessions_document_type_id_hospital_id_fkey";
            columns: ["document_type_id", "hospital_id"];
            referencedRelation: "document_types";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
          {
            foreignKeyName: "scan_sessions_paired_device_id_hospital_id_fkey";
            columns: ["paired_device_id", "hospital_id"];
            referencedRelation: "paired_devices";
            referencedColumns: ["id", "hospital_id"];
            isOneToOne: false;
          },
        ];
      };
      paired_devices: {
        Row: {
          id: string;
          hospital_id: string;
          created_by: string;
          token_hash: string;
          confirmed_at: string | null;
          last_seen_at: string | null;
          created_at: string;
        };
        // hospital_id and created_by both default at the database level.
        Insert: Partial<Database["public"]["Tables"]["paired_devices"]["Row"]> & {
          token_hash: string;
        };
        Update: Partial<Database["public"]["Tables"]["paired_devices"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_profile: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          hospital_id: string | null;
          role: StaffRole;
          status: ProfileStatus;
        }[];
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      next_patient_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_visit_number: {
        Args: Record<string, never>;
        Returns: number;
      };
      search_patients: {
        Args: { p_query: string };
        Returns: Database["public"]["Tables"]["patients"]["Row"][];
      };
      possible_duplicate_patients: {
        Args: { p_name: string; p_mobile: string | null; p_dob: string | null };
        Returns: Database["public"]["Tables"]["patients"]["Row"][];
      };
      search_visits: {
        Args: { p_query: string };
        Returns: Database["public"]["Tables"]["visits"]["Row"][];
      };
    };
  };
}
