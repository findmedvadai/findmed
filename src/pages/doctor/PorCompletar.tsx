import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { ClipboardList, User, Save, Check, FileText } from "lucide-react";

export default function PorCompletar() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["por-completar", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
        .eq("doctor_id", doctorId)
        .is("doctor_notes", null)
        .or(`status.eq.completed,and(status.eq.confirmed,end_at.lt.${nowIso})`)
        .order("start_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Por Completar</h1>
        <p className="text-sm text-muted-foreground">
          Citas completadas que aún necesitan tus notas médicas.
        </p>
      </div>

      {appointments && appointments.length > 0 ? (
        <div className="space-y-4">
          {appointments.map((appt) => (
            <AppointmentNoteCard
              key={appt.id}
              appointment={appt}
              doctorId={doctorId!}
              onSaved={() =>
                queryClient.invalidateQueries({ queryKey: ["por-completar", doctorId] })
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Check className="mb-3 h-10 w-10 text-confirmed" />
            <p className="text-lg font-medium text-muted-foreground">Todo al día</p>
            <p className="text-sm text-muted-foreground/70">
              No hay citas pendientes de notas médicas.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface AppointmentNoteCardProps {
  appointment: {
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    symptoms: string | null;
    doctor_notes: string | null;
    patients: { full_name: string; phone: string } | null;
  };
  doctorId: string;
  onSaved: () => void;
}

function AppointmentNoteCard({ appointment, doctorId, onSaved }: AppointmentNoteCardProps) {
  const [notes, setNotes] = useState("");
  const start = parseISO(appointment.start_at);
  const patient = appointment.patients as { full_name: string; phone: string } | null;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!notes.trim()) throw new Error("Las notas no pueden estar vacías");
      const { error } = await supabase
        .from("appointments")
        .update({
          doctor_notes: notes.trim(),
          doctor_notes_updated_at: new Date().toISOString(),
          status: "completed" as any,
        })
        .eq("id", appointment.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      // Insert admin notification for completed appointment
      try {
        const { data: doctorData } = await supabase
          .from("doctors")
          .select("full_name")
          .eq("id", doctorId)
          .single();

        await supabase.from("notifications").insert({
          doctor_id: doctorId,
          appointment_id: appointment.id,
          recipient_role: "admin",
          type: "appointment_completed",
          title: "Cita completada con notas",
          body: `Dr. ${doctorData?.full_name ?? "Doctor"} completó notas para ${patient?.full_name ?? "Paciente"} (${format(parseISO(appointment.start_at), "d MMM yyyy", { locale: es })})\n\nNotas: ${notes.trim()}`,
        } as any);
      } catch (e) {
        console.error("Error inserting admin notification:", e);
      }
      toast({ title: "Notas guardadas" });
      onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">
              {patient?.full_name ?? "Paciente desconocido"}
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {format(start, "d MMM yyyy · HH:mm", { locale: es })}
          </Badge>
        </div>
        {appointment.symptoms && (
          <CardDescription className="flex items-start gap-1.5 mt-1">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{appointment.symptoms}</span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Escribe las notas médicas de esta consulta…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="resize-none"
        />
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !notes.trim()}
          size="sm"
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMut.isPending ? "Guardando…" : "Guardar notas"}
        </Button>
      </CardContent>
    </Card>
  );
}
