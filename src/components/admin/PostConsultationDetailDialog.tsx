import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
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
} from "lucide-react";
import SendReportModal from "./SendReportModal";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "bg-amber-100 text-amber-800 border-amber-200" },
  read: { label: "Leído", className: "bg-blue-100 text-blue-800 border-blue-200" },
  report_sent: { label: "Informe enviado", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
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

      return { form, appointment: appt };
    },
    enabled: open && !!appointmentId,
  });

  const markReadMut = useMutation({
    mutationFn: async () => {
      if (!data?.form) return;
      const { error } = await supabase
        .from("post_consultation_forms")
        .update({ review_status: "read" } as any)
        .eq("id", (data.form as any).id);
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

  const form = data?.form as any;
  const appt = data?.appointment as any;
  const statusCfg = form ? STATUS_BADGE[form.review_status] ?? STATUS_BADGE.pending : STATUS_BADGE.pending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Formulario Post-Consulta
            </DialogTitle>
            <DialogDescription>Detalle del formulario enviado por el doctor.</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !form ? (
            <p className="text-sm text-muted-foreground py-4">No se encontró el formulario.</p>
          ) : (
            <div className="space-y-5">
              {/* Status badge */}
              <Badge className={statusCfg.className}>{statusCfg.label}</Badge>

              {/* Appointment info */}
              {appt && (
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{appt.patients?.full_name ?? "—"}</span>
                    <span className="text-muted-foreground">· {appt.patients?.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{format(parseISO(appt.start_at), "d MMM yyyy · HH:mm", { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Doctor: {appt.doctors?.full_name ?? "—"}</span>
                  </div>
                  {appt.doctors?.doctor_specialties?.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {appt.doctors.doctor_specialties.map((ds: any, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {ds.specialties?.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {appt.doctors?.cities?.name && (
                    <span className="text-muted-foreground text-xs">
                      {appt.doctors.cities.name}{appt.doctors.zones?.name ? ` · ${appt.doctors.zones.name}` : ""}
                    </span>
                  )}
                  {appt.symptoms && (
                    <div className="text-muted-foreground">
                      <span className="font-medium text-foreground">Síntomas: </span>
                      {appt.symptoms}
                    </div>
                  )}
                </div>
              )}

              {/* Observations */}
              {form.observations && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">Observaciones</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{form.observations}</p>
                </div>
              )}

              {/* Actions */}
              {ACTION_FIELDS.filter((f) => form[f.key]).map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium">{f.label}</p>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-line ml-6">{form[f.key]}</p>
                  </div>
                );
              })}

              {/* No actions and no observations */}
              {!form.observations && ACTION_FIELDS.every((f) => !form[f.key]) && (
                <p className="text-sm text-muted-foreground italic">El doctor envió el formulario sin observaciones ni acciones.</p>
              )}

              {/* Submission time */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Enviado: {format(parseISO(form.created_at), "d MMM yyyy · HH:mm", { locale: es })}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t">
                {form.review_status === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => markReadMut.mutate()}
                    disabled={markReadMut.isPending}
                  >
                    <Eye className="h-4 w-4" />
                    Marcar como leído
                  </Button>
                )}
                {form.review_status !== "report_sent" && (
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => setSendReportOpen(true)}
                  >
                    <Send className="h-4 w-4" />
                    Enviar Informe
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {form && (
        <SendReportModal
          open={sendReportOpen}
          onOpenChange={setSendReportOpen}
          formId={(form as any).id}
          appointmentId={appointmentId!}
          onSuccess={handleReportSent}
        />
      )}
    </>
  );
}
