import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { cn } from "@/lib/utils";
import {
  User,
  Calendar,
  Pill,
  ScanLine,
  FlaskConical,
  UserRoundPlus,
  Building2,
  FileText,
  Clock,
  Eye,
  Send,
  MapPin,
  Stethoscope,
  CheckCircle2,
  LifeBuoy,
} from "lucide-react";
import { Link } from "react-router-dom";
import { isManagementType, MANAGEMENT_TYPE_INFO } from "@/lib/management-type";
import { CASE_PRIORITY, CASE_STATUS, caseTypeLabel } from "@/lib/case-labels";
import SendReportModal from "./SendReportModal";

const STATUS_BADGE: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente de revisión", tone: "warning" },
  read: { label: "Leído", tone: "info" },
  report_sent: { label: "Informe enviado", tone: "success" },
};

const ACTION_FIELDS = [
  { key: "prescribed_medications", label: "Medicamentos recetados", icon: Pill },
  { key: "imaging_studies", label: "Estudios de imagen", icon: ScanLine },
  { key: "lab_tests", label: "Análisis de laboratorio", icon: FlaskConical },
  { key: "specialist_referral", label: "Referencia a especialista", icon: UserRoundPlus },
  { key: "hospitalization", label: "Hospitalización", icon: Building2 },
] as const;

interface Props {
  appointmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InfoItem({ icon: Icon, label, children, className }: { icon: ComponentType<{ className?: string }>; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}

export default function PostConsultationDetailDialog({ appointmentId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [sendReportOpen, setSendReportOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["post-consultation-detail", appointmentId],
    queryFn: async () => {
      if (!appointmentId) return null;
      const { data: forms, error } = await supabase
        .from("post_consultation_forms")
        .select("*")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const form = forms?.[0];
      if (!form) return null;

      const { data: appt } = await supabase
        .from("appointments")
        .select("*, patients(full_name, phone), doctors(full_name, city_id, zone_id, cities(name), zones(name), doctor_specialties(specialties(name)))")
        .eq("id", appointmentId)
        .single();

      // Casos que abrió (o actualizó) este formulario — Etapa 2.
      const { data: links } = await supabase
        .from("post_consultation_case_links")
        .select("request_type, outcome, case_id, patient_cases(id, request_type, priority, status)")
        .eq("form_id", form.id)
        .order("created_at", { ascending: true });

      return { form, appointment: appt, cases: links ?? [] };
    },
    enabled: open && !!appointmentId,
  });

  const markReadMut = useMutation({
    mutationFn: async () => {
      if (!data?.form) return;
      const { error } = await supabase
        .from("post_consultation_forms")
        .update({ review_status: "read" })
        .eq("id", data.form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-consultation-detail"] });
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
      toast({ title: "Marcado como leído" });
    },
  });

  const handleReportSent = () => {
    setSendReportOpen(false);
    queryClient.invalidateQueries({ queryKey: ["post-consultation-detail"] });
    queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
  };

  if (!open) return null;

  const form = data?.form ?? null;
  const appt = data?.appointment ?? null;
  const generatedCases = data?.cases ?? [];
  const managementType = form && isManagementType(form.management_type) ? MANAGEMENT_TYPE_INFO[form.management_type] : null;
  const statusCfg = form ? STATUS_BADGE[form.review_status] ?? STATUS_BADGE.pending : STATUS_BADGE.pending;
  const actions = form ? ACTION_FIELDS.filter((f) => form[f.key]) : [];
  const specialties: string[] = (appt?.doctors?.doctor_specialties ?? [])
    .map((ds: { specialties?: { name?: string } | null }) => ds.specialties?.name)
    .filter(Boolean);
  const where = appt?.doctors?.cities?.name
    ? `${appt.doctors.cities.name}${appt.doctors.zones?.name ? ` · ${appt.doctors.zones.name}` : ""}`
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="space-y-1 border-b p-4 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Formulario post-consulta
              </DialogTitle>
              {form && <SoftBadge tone={statusCfg.tone} dot>{statusCfg.label}</SoftBadge>}
              {managementType && <SoftBadge tone={managementType.tone}>{managementType.label}</SoftBadge>}
            </div>
            <DialogDescription className="text-xs">Notas que envió el doctor después de la consulta.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !form ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No se encontró el formulario.</p>
            ) : (
              <>
                {/* Appointment info */}
                {appt && (
                  <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                    <InfoItem icon={User} label="Paciente">
                      <span className="font-medium">{appt.patients?.full_name ?? "—"}</span>
                      {appt.patients?.phone && <span className="block text-xs text-muted-foreground">{appt.patients.phone}</span>}
                    </InfoItem>
                    <InfoItem icon={Calendar} label="Consulta">
                      {format(parseISO(appt.start_at), "EEEE d 'de' MMMM yyyy · HH:mm", { locale: es })}
                    </InfoItem>
                    <InfoItem icon={Stethoscope} label="Doctor">
                      <span>{appt.doctors?.full_name ?? "—"}</span>
                      {specialties.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {specialties.map((name, i) => (
                            <SoftBadge key={`${name}-${i}`} tone="neutral">{name}</SoftBadge>
                          ))}
                        </span>
                      )}
                    </InfoItem>
                    {where && <InfoItem icon={MapPin} label="Ubicación">{where}</InfoItem>}
                    {appt.symptoms && (
                      <InfoItem icon={FileText} label="Motivo de consulta" className="sm:col-span-2">
                        {appt.symptoms}
                      </InfoItem>
                    )}
                  </dl>
                )}

                {/* Observations */}
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground">Observaciones</h3>
                  {form.observations ? (
                    <p className="whitespace-pre-line text-sm text-foreground">{form.observations}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">El doctor no agregó observaciones.</p>
                  )}
                </section>

                {/* Actions */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Acciones indicadas</h3>
                  {actions.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {actions.map((f) => {
                        const Icon = f.icon;
                        return (
                          <div key={f.key} className="rounded-lg border p-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <p className="text-sm font-medium text-foreground">{f.label}</p>
                            </div>
                            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{form[f.key]}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sin medicamentos, estudios, referencias ni hospitalización.</p>
                  )}
                </section>

                {/* Tipo de manejo y casos generados (Etapa 2) */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Tipo de manejo y seguimiento</h3>
                  {managementType ? (
                    <p className="text-sm text-foreground">
                      <SoftBadge tone={managementType.tone} dot>{managementType.label}</SoftBadge>
                      <span className="mt-1 block text-xs text-muted-foreground">{managementType.description}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">El doctor no indicó el tipo de manejo (formulario anterior a este cambio).</p>
                  )}
                  {generatedCases.length > 0 ? (
                    <ul className="divide-y rounded-lg border">
                      {generatedCases.map((l) => {
                        const c = l.patient_cases;
                        const prio = CASE_PRIORITY[c?.priority ?? "normal"] ?? CASE_PRIORITY.normal;
                        const st = c ? CASE_STATUS[c.status] : null;
                        return (
                          <li key={l.request_type} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <LifeBuoy className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="text-sm font-medium text-foreground">{caseTypeLabel(l.request_type)}</span>
                              {c?.priority && c.priority !== "normal" && <SoftBadge tone={prio.tone} dot>{prio.label}</SoftBadge>}
                              {st && <SoftBadge tone={st.tone}>{st.label}</SoftBadge>}
                              {l.outcome === "appended" && <span className="text-xs text-muted-foreground">Se agregó a un caso que ya existía</span>}
                            </div>
                            <Button asChild size="sm" variant="ghost" className="h-8 px-2">
                              <Link to={`/admin/casos?caso=${l.case_id}`} onClick={() => onOpenChange(false)}>Ver caso</Link>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Este formulario no generó casos de seguimiento.</p>
                  )}
                </section>

                {form.review_status === "report_sent" && form.report_sent_at && (
                  <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>
                      Informe enviado
                      {form.report_destination_type === "hospital" ? " al hospital" : form.report_destination_type === "laboratory" ? " al laboratorio" : ""}{" "}
                      el {format(parseISO(form.report_sent_at), "d MMM yyyy · HH:mm", { locale: es })}.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {form && !isLoading && (
            <div className="flex flex-col-reverse gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Enviado el {format(parseISO(form.created_at), "d MMM yyyy · HH:mm", { locale: es })}
              </p>
              {form.review_status !== "report_sent" && (
                <div className="flex flex-wrap justify-end gap-2">
                  {form.review_status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => markReadMut.mutate()}
                      disabled={markReadMut.isPending}
                    >
                      <Eye className="h-4 w-4" />
                      Marcar como leído
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setSendReportOpen(true)}
                  >
                    <Send className="h-4 w-4" />
                    Enviar informe
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {form && (
        <SendReportModal
          open={sendReportOpen}
          onOpenChange={setSendReportOpen}
          formId={form.id}
          appointmentId={appointmentId!}
          onSuccess={handleReportSent}
        />
      )}
    </>
  );
}
