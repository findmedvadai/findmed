// Cliente de la Edge Function case-actions para las acciones de la Etapa 2
// ("Nuevo caso" y reembolsos). Los errores se lanzan tal cual para pasarlos
// por extractEdgeFunctionError en la vista.
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PatientCase = Tables<"patient_cases">;
export type Reimbursement = Tables<"reimbursements">;

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("case-actions", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) throw res.error;
  return res.data as T;
}

export interface CreateCaseInput {
  request_type: string;
  priority: string;
  summary: string;
  patient_id?: string;
  phone?: string;
  contact_name?: string;
}

export const createCase = (input: CreateCaseInput) =>
  invoke<{ case: PatientCase; warnings: string[]; deduplicated: boolean }>({ action: "create_case", ...input });

export interface ReimbursementInput {
  insurer?: string;
  invoice_number?: string | null;
  amount?: number | null;
  currency?: string;
  status?: string;
  notes?: string | null;
}

export const createReimbursement = (caseId: string, input: ReimbursementInput) =>
  invoke<{ reimbursement: Reimbursement }>({ action: "reimbursement_create", case_id: caseId, ...input });

export const updateReimbursement = (caseId: string, reimbursementId: string, input: ReimbursementInput) =>
  invoke<{ reimbursement: Reimbursement }>({
    action: "reimbursement_update",
    case_id: caseId,
    reimbursement_id: reimbursementId,
    ...input,
  });
