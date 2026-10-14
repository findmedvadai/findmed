// Panel "Reembolso" del detalle de un caso (Etapa 2): registro estructurado de
// facturas / reembolsos (aseguradora, número de factura, monto, moneda, estado
// y notas). Los estados solo avanzan: recibido → en proceso → finalizado o
// rechazado. Cada cambio queda en el historial del caso (case_events).
// Escrituras vía case-actions; lectura por RLS (solo admins).
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { formatMx } from "@/lib/timezone";
import { es } from "date-fns/locale";
import { Pencil, Plus, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SoftBadge } from "@/components/app/StatusBadge";
import { toast } from "@/hooks/use-toast";
import { extractEdgeFunctionError, toastFromEdgeFunctionError } from "@/lib/edge-function-error";
import {
  formatMoney,
  nextReimbursementStatuses,
  REIMBURSEMENT_STATUS,
  REIMBURSEMENT_STATUSES,
  type ReimbursementStatus,
} from "@/lib/case-labels";
import {
  createReimbursement,
  updateReimbursement,
  type PatientCase,
  type Reimbursement,
  type ReimbursementInput,
} from "@/lib/case-actions";

const CURRENCIES = ["MXN", "USD"];
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const day = (iso: string) => formatMx(parseISO(iso), "d MMM yyyy", { locale: es });

interface Props {
  caseRow: PatientCase;
  closed: boolean;
  /** Para refrescar el historial del caso después de cada cambio. */
  onChanged: () => void;
}

export default function CaseReimbursementPanel({ caseRow, closed, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [formFor, setFormFor] = useState<string | null>(null); // "new" | reimbursement id
  const [confirm, setConfirm] = useState<{ r: Reimbursement; to: ReimbursementStatus } | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["case-reimbursements", caseRow.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reimbursements")
        .select("*")
        .eq("case_id", caseRow.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: keepPreviousData,
  });
  // Con keepPreviousData pueden llegar los del caso anterior mientras carga.
  const rows = (data ?? []).filter((r) => r.case_id === caseRow.id);

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ReimbursementInput }) =>
      id ? updateReimbursement(caseRow.id, id, input) : createReimbursement(caseRow.id, input),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["case-reimbursements", caseRow.id] });
      onChanged();
      setFormFor(null);
      setConfirm(null);
      toast({ title: vars.id ? "Reembolso actualizado" : "Reembolso registrado" });
    },
    onError: async (err) => {
      setConfirm(null);
      const parsed = await extractEdgeFunctionError(err);
      const { title, description } = toastFromEdgeFunctionError(parsed, "No se pudo guardar el reembolso");
      toast({ title, description, variant: "destructive" });
    },
  });

  const isReimbursementCase = caseRow.request_type === "reimbursement";
  // En casos de otro tipo, el panel solo aparece si ya hay reembolsos o si el equipo lo pide.
  if (!isReimbursementCase && rows.length === 0 && formFor === null) {
    if (closed) return null;
    return (
      <div className="flex justify-start">
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground" onClick={() => setFormFor("new")}>
          <Receipt className="h-4 w-4" /> Registrar un reembolso en este caso
        </Button>
      </div>
    );
  }

  const busy = save.isPending;
  const showNewForm = formFor === "new" || (isReimbursementCase && !closed && !isPending && rows.length === 0 && formFor === null);

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Receipt className="h-4 w-4 text-muted-foreground" /> Reembolso
          </h3>
          <p className="text-xs text-muted-foreground">Facturas y reembolsos de este caso. Cada cambio queda en el historial.</p>
        </div>
        {!closed && rows.length > 0 && formFor !== "new" && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => setFormFor("new")}>
            <Plus className="h-3.5 w-3.5" /> Agregar
          </Button>
        )}
      </div>

      {isPending && rows.length === 0 ? (
        <Skeleton className="h-20 w-full rounded-md" />
      ) : (
        rows.map((r) =>
          formFor === r.id ? (
            <ReimbursementForm
              key={r.id}
              initial={r}
              busy={busy}
              onCancel={() => setFormFor(null)}
              onSubmit={(input) => save.mutate({ id: r.id, input })}
            />
          ) : (
            <ReimbursementItem
              key={r.id}
              r={r}
              editable={!closed}
              busy={busy}
              onEdit={() => setFormFor(r.id)}
              onStatus={(to) =>
                REIMBURSEMENT_STATUS[to].stage >= 2 ? setConfirm({ r, to }) : save.mutate({ id: r.id, input: { status: to } })}
            />
          ),
        )
      )}

      {rows.length === 0 && !isPending && closed && <p className="text-sm text-muted-foreground">Sin reembolsos registrados.</p>}

      {showNewForm && !closed && (
        <ReimbursementForm
          busy={busy}
          onCancel={rows.length > 0 || !isReimbursementCase ? () => setFormFor(null) : undefined}
          onSubmit={(input) => save.mutate({ id: null, input })}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Marcar el reembolso como {confirm ? REIMBURSEMENT_STATUS[confirm.to].label.toLowerCase() : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Es un estado final: después ya no se podrá editar este reembolso. Si hace falta corregir algo, agrega una nota al caso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) save.mutate({ id: confirm.r.id, input: { status: confirm.to } });
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ReimbursementItem({
  r,
  editable,
  busy,
  onEdit,
  onStatus,
}: {
  r: Reimbursement;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
  onStatus: (to: ReimbursementStatus) => void;
}) {
  const status = REIMBURSEMENT_STATUS[r.status as ReimbursementStatus] ?? { label: r.status, tone: "neutral" as const, stage: 0 };
  const next = nextReimbursementStatuses(r.status);
  const money = formatMoney(r.amount, r.currency);
  const canEdit = editable && next.length > 0;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{r.insurer}</p>
          <p className="text-xs text-muted-foreground">
            {r.invoice_number ? `Factura ${r.invoice_number}` : "Sin número de factura"} · {money ?? "Sin monto"}
          </p>
        </div>
        <SoftBadge tone={status.tone} dot>{status.label}</SoftBadge>
      </div>
      <p className="text-xs text-muted-foreground">
        Registrado el {day(r.created_at)}
        {r.submitted_at && ` · enviado a la aseguradora el ${day(r.submitted_at)}`}
        {r.resolved_at && ` · cerrado el ${day(r.resolved_at)}`}
      </p>
      {r.notes && <p className="whitespace-pre-wrap rounded-md bg-background px-2.5 py-1.5 text-sm text-foreground">{r.notes}</p>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select value="" onValueChange={(v) => onStatus(v as ReimbursementStatus)} disabled={busy}>
            <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Cambiar estado del reembolso">
              <SelectValue placeholder="Cambiar estado…" />
            </SelectTrigger>
            <SelectContent>
              {next.map((s) => (
                <SelectItem key={s} value={s}>{REIMBURSEMENT_STATUS[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2" disabled={busy} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </div>
      )}
    </div>
  );
}

function ReimbursementForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Reimbursement;
  busy: boolean;
  onSubmit: (input: ReimbursementInput) => void;
  onCancel?: () => void;
}) {
  const prefix = `rb-${initial?.id ?? "new"}`;
  const [insurer, setInsurer] = useState(initial?.insurer ?? "");
  const [invoice, setInvoice] = useState(initial?.invoice_number ?? "");
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "MXN");
  const [status, setStatus] = useState<ReimbursementStatus>("recibido");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const amountClean = amount.trim().replace(/,/g, "");
  const amountOk = amountClean === "" || AMOUNT_RE.test(amountClean);
  const canSave = insurer.trim().length >= 2 && amountOk && !busy;
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency];

  const submit = () => {
    const input: ReimbursementInput = {
      insurer: insurer.trim(),
      invoice_number: invoice.trim() || null,
      amount: amountClean === "" ? null : Number(amountClean),
      currency,
      notes: notes.trim() || null,
    };
    if (!initial) input.status = status;
    onSubmit(input);
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-xs font-medium text-muted-foreground">{initial ? "Editar reembolso" : "Registrar reembolso"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-insurer`} className="text-xs font-medium">Aseguradora</Label>
          <Input id={`${prefix}-insurer`} className="h-9 text-sm" value={insurer} maxLength={120} placeholder="Ej. AXA, GNP, MetLife" onChange={(e) => setInsurer(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-invoice`} className="text-xs font-medium">Número de factura</Label>
          <Input id={`${prefix}-invoice`} className="h-9 text-sm" value={invoice} maxLength={60} onChange={(e) => setInvoice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-amount`} className="text-xs font-medium">Monto</Label>
          <div className="flex gap-2">
            <Input
              id={`${prefix}-amount`}
              inputMode="decimal"
              className="h-9 min-w-0 flex-1 text-sm tabular-nums"
              value={amount}
              placeholder="0.00"
              aria-invalid={!amountOk}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-9 w-[88px] text-sm" aria-label="Moneda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!amountOk && <p className="text-xs text-destructive">Usa solo números, con hasta 2 decimales.</p>}
        </div>
        {!initial && (
          <div className="space-y-1">
            <Label htmlFor={`${prefix}-status`} className="text-xs font-medium">Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ReimbursementStatus)}>
              <SelectTrigger id={`${prefix}-status`} className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REIMBURSEMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{REIMBURSEMENT_STATUS[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${prefix}-notes`} className="text-xs font-medium">Notas</Label>
        <Textarea id={`${prefix}-notes`} rows={2} className="resize-none text-sm" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button size="sm" disabled={!canSave} onClick={submit}>
          {busy ? "Guardando…" : initial ? "Guardar cambios" : "Registrar"}
        </Button>
      </div>
    </div>
  );
}
