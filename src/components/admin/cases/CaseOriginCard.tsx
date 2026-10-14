// Origen de un caso abierto (o actualizado) por la post-consulta (Etapa 2):
// tipo de manejo que confirmó el médico, quién y cuándo, con acceso a la cita
// y al formulario. Si el caso solo tiene una cita relacionada, muestra esa.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, ClipboardList, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SoftBadge } from "@/components/app/StatusBadge";
import AppointmentDetailDialog from "@/components/admin/AppointmentDetailDialog";
import PostConsultationDetailDialog from "@/components/admin/PostConsultationDetailDialog";
import { isManagementType, MANAGEMENT_TYPE_INFO } from "@/lib/management-type";
import type { PatientCase } from "@/lib/case-actions";

interface Origin {
  formId: string | null;
  appointmentId: string;
  managementType: string | null;
  startAt: string | null;
  doctorName: string | null;
  outcome: string | null;
}

export default function CaseOriginCard({ caseRow }: { caseRow: PatientCase }) {
  const [apptOpen, setApptOpen] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["case-origin", caseRow.id],
    queryFn: async (): Promise<{ caseId: string; origins: Origin[] }> => {
      const { data: links, error } = await supabase
        .from("post_consultation_case_links")
        .select("form_id, outcome, created_at, post_consultation_forms(id, management_type, appointment_id, appointments(start_at, doctors(full_name)))")
        .eq("case_id", caseRow.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const origins: Origin[] = (links ?? []).flatMap((l) => {
        const f = l.post_consultation_forms;
        if (!f) return [];
        return [{
          formId: f.id,
          appointmentId: f.appointment_id,
          managementType: f.management_type,
          startAt: f.appointments?.start_at ?? null,
          doctorName: f.appointments?.doctors?.full_name ?? null,
          outcome: l.outcome,
        }];
      });
      if (origins.length === 0 && caseRow.appointment_id) {
        const { data: appt } = await supabase
          .from("appointments")
          .select("start_at, doctors(full_name)")
          .eq("id", caseRow.appointment_id)
          .maybeSingle();
        origins.push({
          formId: null,
          appointmentId: caseRow.appointment_id,
          managementType: null,
          startAt: appt?.start_at ?? null,
          doctorName: appt?.doctors?.full_name ?? null,
          outcome: null,
        });
      }
      return { caseId: caseRow.id, origins };
    },
    placeholderData: keepPreviousData,
  });

  const origins = data?.caseId === caseRow.id ? data.origins : [];
  if (origins.length === 0) return null;
  const fromPostConsult = origins.some((o) => o.formId);

  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{fromPostConsult ? "Origen: post-consulta" : "Cita relacionada"}</h3>
        {fromPostConsult && (
          <p className="text-xs text-muted-foreground">El médico confirmó el tipo de manejo y FindMed abrió el seguimiento.</p>
        )}
      </div>
      <ul className="space-y-2">
        {origins.map((o) => {
          const mt = isManagementType(o.managementType) ? MANAGEMENT_TYPE_INFO[o.managementType] : null;
          return (
            <li key={o.formId ?? o.appointmentId} className="flex flex-col gap-2 rounded-md border bg-background p-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                {o.formId && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Tipo de manejo:</span>
                    {mt ? <SoftBadge tone={mt.tone} dot>{mt.label}</SoftBadge> : <SoftBadge tone="neutral">Sin indicar</SoftBadge>}
                    {o.outcome === "appended" && <span className="text-xs text-muted-foreground">(se agregó a este caso)</span>}
                  </div>
                )}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {o.doctorName && (
                    <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{o.doctorName}</span>
                  )}
                  {o.startAt && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {format(parseISO(o.startAt), "d MMM yyyy · HH:mm", { locale: es })}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setApptOpen(o.appointmentId)}>
                  <CalendarDays className="h-3.5 w-3.5" /> Ver cita
                </Button>
                {o.formId && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setFormOpen(o.appointmentId)}>
                    <ClipboardList className="h-3.5 w-3.5" /> Ver formulario
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <AppointmentDetailDialog appointmentId={apptOpen} open={!!apptOpen} onOpenChange={(o) => !o && setApptOpen(null)} />
      <PostConsultationDetailDialog appointmentId={formOpen} open={!!formOpen} onOpenChange={(o) => !o && setFormOpen(null)} />
    </section>
  );
}
