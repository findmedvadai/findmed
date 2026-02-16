import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, CheckCircle, XCircle, AlertTriangle, CalendarDays, Clock, User } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Reservada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
};

interface AppointmentData {
  appointment_id: string;
  doctor_id: string;
  doctor_name: string;
  doctor_address: string | null;
  patient_name: string;
  start_at: string;
  end_at: string;
  status: string;
}

export default function Gestionar() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState<AppointmentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  // Reschedule state
  const [showReschedule, setShowReschedule] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Enlace inválido. No se proporcionó un token.");
      setLoading(false);
      return;
    }

    fetch(`${SUPABASE_URL}/functions/v1/manage-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setAppointment(data);
          if (data.status === "cancelled") setCancelled(true);
        }
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch slots when reschedule date changes
  useEffect(() => {
    if (!selectedDate || !appointment) return;
    setLoadingSlots(true);
    setSelectedSlot(null);

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    fetch(`${SUPABASE_URL}/functions/v1/reserve-slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ doctor_id: appointment.doctor_id, date: dateStr }),
    })
      .then((res) => res.json())
      .then((data) => setSlots(data.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, appointment]);

  const handleCancel = async () => {
    if (!token) return;
    setCancelling(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setCancelled(true);
        toast.success("Cita cancelada exitosamente");
      }
    } catch {
      toast.error("Error al cancelar la cita");
    } finally {
      setCancelling(false);
    }
  };

  const handleReschedule = async () => {
    if (!token || !selectedDate || !selectedSlot) return;
    setRescheduling(true);

    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ token, slot_start: selectedSlot, date: dateStr }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setAppointment((prev) =>
          prev
            ? {
                ...prev,
                appointment_id: data.appointment_id,
                start_at: data.start_at,
                end_at: data.end_at,
                status: "scheduled",
                patient_name: data.patient_name,
              }
            : prev
        );
        setCancelled(false);
        setShowReschedule(false);
        setSelectedDate(undefined);
        setSelectedSlot(null);
        toast.success("Cita reagendada exitosamente");
      }
    } catch {
      toast.error("Error al reagendar la cita");
    } finally {
      setRescheduling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!appointment) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tu cita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-muted-foreground">Paciente:</span>{" "}
                <span className="text-foreground">{appointment.patient_name}</span>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Doctor:</span>{" "}
                <span className="text-foreground">{appointment.doctor_name}</span>
              </div>
              {appointment.doctor_address && (
                <div>
                  <span className="font-medium text-muted-foreground">Dirección:</span>{" "}
                  <span className="text-foreground">{appointment.doctor_address}</span>
                </div>
              )}
              <div>
                <span className="font-medium text-muted-foreground">Fecha:</span>{" "}
                <span className="text-foreground">
                  {format(new Date(appointment.start_at), "EEEE d 'de' MMMM, yyyy", { locale: es })}
                </span>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Horario:</span>{" "}
                <span className="text-foreground">
                  {format(new Date(appointment.start_at), "HH:mm")} - {format(new Date(appointment.end_at), "HH:mm")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Estado:</span>
                {cancelled || appointment.status === "cancelled" ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" /> {STATUS_LABELS.cancelled}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" /> {STATUS_LABELS[appointment.status] ?? appointment.status}
                  </span>
                )}
              </div>
            </div>

            {!cancelled && appointment.status !== "cancelled" && (
              <div className="space-y-2 pt-2">
                {/* Reschedule button */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowReschedule(!showReschedule)}
                >
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Reagendar cita
                </Button>

                {/* Cancel button */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full" disabled={cancelling}>
                      {cancelling ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Cancelando...
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Cancelar cita
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Cancelar cita?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Tu cita con {appointment.doctor_name} el{" "}
                        {format(new Date(appointment.start_at), "d 'de' MMMM", { locale: es })} a las{" "}
                        {format(new Date(appointment.start_at), "HH:mm")} será cancelada.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>No, mantener</AlertDialogCancel>
                      <AlertDialogAction onClick={handleCancel}>
                        Sí, cancelar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reschedule section */}
        {showReschedule && !cancelled && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Selecciona nueva fecha</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < today}
                  locale={es}
                />
              </CardContent>
            </Card>

            {selectedDate && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Horarios disponibles — {format(selectedDate, "d 'de' MMMM", { locale: es })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingSlots ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay horarios disponibles para esta fecha
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map((slot) => (
                        <Button
                          key={slot}
                          variant={selectedSlot === slot ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedSlot(slot)}
                          className="text-sm"
                        >
                          {slot}
                        </Button>
                      ))}
                    </div>
                  )}

                  {selectedSlot && (
                    <div className="mt-4 pt-4 border-t">
                      <Button
                        className="w-full"
                        onClick={handleReschedule}
                        disabled={rescheduling}
                      >
                        {rescheduling ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Reagendando...
                          </>
                        ) : (
                          "Confirmar reagendamiento"
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
