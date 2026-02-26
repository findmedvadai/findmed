import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Phone,
  Stethoscope,
  Calendar,
  Clock,
  FileText,
  ClipboardList,
} from "lucide-react";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Programada", className: "bg-blue-100 text-blue-800" },
  confirmed: { label: "Confirmada", className: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelada", className: "bg-red-100 text-red-800" },
  completed: { label: "Completada", className: "bg-primary/10 text-primary" },
};

interface Props {
  appointmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AppointmentDetailDialog({
  appointmentId,
  open,
  onOpenChange,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-appointment-detail", appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          `id, start_at, end_at, status, symptoms,
           doctor_notes, doctor_notes_updated_at,
           patients(full_name, phone),
           doctors(full_name, doctor_specialties(specialties(name)))`
        )
        .eq("id", appointmentId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!appointmentId && open,
  });

  const patient = data?.patients as any;
  const doctor = data?.doctors as any;
  const specialties = (doctor?.doctor_specialties as any[])
    ?.map((ds: any) => ds.specialties?.name)
    .filter(Boolean);
  const status = STATUS_MAP[data?.status ?? ""] ?? STATUS_MAP.scheduled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detalle de cita</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-4 text-sm">
            {/* Status */}
            <div className="flex justify-end">
              <Badge className={status.className}>{status.label}</Badge>
            </div>

            {/* Patient */}
            <Section icon={User} label="Paciente">
              <p className="font-medium">{patient?.full_name ?? "—"}</p>
              {patient?.phone && (
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {patient.phone}
                </p>
              )}
            </Section>

            {/* Doctor */}
            <Section icon={Stethoscope} label="Doctor">
              <p className="font-medium">{doctor?.full_name ?? "—"}</p>
              {specialties && specialties.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {specialties.map((s: string) => (
                    <Badge key={s} variant="outline" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </Section>

            {/* Date & time */}
            <Section icon={Calendar} label="Fecha y horario">
              <p>
                {data.start_at &&
                  format(parseISO(data.start_at), "EEEE d 'de' MMMM yyyy", {
                    locale: es,
                  })}
              </p>
              <p className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {data.start_at && format(parseISO(data.start_at), "HH:mm")}
                {" – "}
                {data.end_at && format(parseISO(data.end_at), "HH:mm")}
              </p>
            </Section>

            {/* Symptoms */}
            <Section icon={ClipboardList} label="Síntomas iniciales">
              <p className="whitespace-pre-line text-muted-foreground">
                {data.symptoms || "Sin síntomas registrados"}
              </p>
            </Section>

            {/* Doctor notes */}
            <Section icon={FileText} label="Notas médicas">
              <p className="whitespace-pre-line text-muted-foreground">
                {data.doctor_notes || "Sin notas"}
              </p>
              {data.doctor_notes_updated_at && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Actualizado:{" "}
                  {format(
                    parseISO(data.doctor_notes_updated_at),
                    "d MMM yyyy · HH:mm",
                    { locale: es }
                  )}
                </p>
              )}
            </Section>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-4">
            No se encontró la cita.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="pl-5">{children}</div>
    </div>
  );
}
