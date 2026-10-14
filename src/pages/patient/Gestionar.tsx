import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, CalendarDays, Clock, User } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  formatMx,
  isBeforeMexicoToday,
  mexicoTodayPickerDate,
  pickerDateToYmd,
} from "@/lib/timezone";
import { CALENDAR_LABELS_ES } from "@/lib/calendar-labels";
import { APPOINTMENT_STATUS } from "@/lib/appointment-status";
import { CONNECTION_ERROR, PATIENT_LINK_HELP, patientLinkError, readPatientResponse } from "@/lib/patient-link";

// Fecha y hora de la cita y los horarios para reagendar son siempre hora de
// CDMX, aunque el paciente abra el enlace desde otra zona horaria.
const MX_TIME_NOTE = "Horarios en hora del centro de México.";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Etiquetas de src/lib/appointment-status.ts (iguales al panel). Verde solo
// para la confirmada: una cita reservada aún está por confirmar.
const STATUS_STYLE: Record<string, { className: string; Icon: typeof CheckCircle2 }> = {
  scheduled: { className: "text-warning", Icon: Clock },
  confirmed: { className: "text-confirmed", Icon: CheckCircle2 },
  cancelled: { className: "text-destructive", Icon: XCircle },
  completed: { className: "text-info", Icon: CheckCircle2 },
};

interface AppointmentData {
  appointment_id: string;
  doctor_id: string;
  office_id: string | null;
  office_name: string | null;
  office_address: string | null;
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
      setError(patientLinkError(null));
      setLoading(false);
      return;
    }

    fetch(`${SUPABASE_URL}/functions/v1/manage-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ token }),
    })
      .then((res) => readPatientResponse<AppointmentData>(res))
      .then(({ data, error }) => {
        if (error || !data?.start_at) {
          setError(patientLinkError(error));
        } else {
          setAppointment(data);
          if (data.status === "cancelled") setCancelled(true);
        }
      })
      .catch(() => setError(CONNECTION_ERROR))
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch slots when reschedule date changes
  useEffect(() => {
    if (!selectedDate || !appointment) return;
    setLoadingSlots(true);
    setSelectedSlot(null);

    // Fecha de CDMX ("yyyy-MM-dd"); los slots que vuelven son horas de CDMX.
    const dateStr = pickerDateToYmd(selectedDate);
    fetch(`${SUPABASE_URL}/functions/v1/reserve-slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      // Slots must come from the appointment's own office: manage-reschedule
      // keeps the office, and a doctor with several offices has different
      // hours in each. Sending only doctor_id resolved to the oldest office.
      body: JSON.stringify(
        appointment.office_id
          ? { office_id: appointment.office_id, date: dateStr }
          : { doctor_id: appointment.doctor_id, date: dateStr }
      ),
    })
      .then((res) => readPatientResponse<{ slots?: string[] }>(res))
      .then(({ data, error }) => {
        // Un error no es "no hay horarios": se avisa para que intente de nuevo.
        if (error) toast.error("No pudimos cargar los horarios de ese día. Intenta de nuevo.");
        setSlots(data?.slots || []);
      })
      .catch(() => {
        toast.error(CONNECTION_ERROR);
        setSlots([]);
      })
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

      const { error } = await readPatientResponse(res);
      if (error) {
        toast.error(error);
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
      const dateStr = pickerDateToYmd(selectedDate);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ token, slot_start: selectedSlot, date: dateStr }),
      });

      const { data, error } = await readPatientResponse<Partial<AppointmentData>>(res);
      if (error || !data) {
        toast.error(error ?? CONNECTION_ERROR);
      } else {
        setAppointment((prev) =>
          prev
            ? {
                ...prev,
                appointment_id: data.appointment_id,
                start_at: data.start_at,
                end_at: data.end_at,
                status: data.status || "scheduled",
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
            <p className="font-semibold text-foreground">No pudimos abrir tu cita</p>
            <p className="mt-2 text-destructive">{error}</p>
            <p className="mt-3 text-sm text-muted-foreground">{PATIENT_LINK_HELP}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!appointment) return null;

  // Mirrors manage-reschedule: completed consultations and past appointments
  // can't be rescheduled; cancelled ones can (the page invites it).
  const isCancelled = cancelled || appointment.status === "cancelled";
  const statusKey = isCancelled ? "cancelled" : appointment.status;
  const status = STATUS_STYLE[statusKey] ?? { className: "text-muted-foreground", Icon: Clock };
  const statusLabel = APPOINTMENT_STATUS[statusKey]?.label ?? statusKey;
  const isFuture = new Date(appointment.start_at).getTime() > Date.now();
  const canReschedule = appointment.status !== "completed" && (isCancelled || isFuture);
  // manage-cancel solo cancela citas agendadas/confirmadas que no han pasado (409 si no).
  const canCancel = !isCancelled && (appointment.status === "scheduled" || appointment.status === "confirmed") && isFuture;

  // "Hoy" es el de CDMX, no el del navegador (ver Reserva.tsx).
  const mxToday = mexicoTodayPickerDate();
  const startAt = new Date(appointment.start_at);
  const endAt = new Date(appointment.end_at);

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
              {appointment.office_name && (
                <div>
                  <span className="font-medium text-muted-foreground">Consultorio:</span>{" "}
                  <span className="text-foreground">{appointment.office_name}</span>
                </div>
              )}
              {(appointment.office_address || appointment.doctor_address) && (
                <div>
                  <span className="font-medium text-muted-foreground">Dirección:</span>{" "}
                  <span className="text-foreground">
                    {appointment.office_address ?? appointment.doctor_address}
                  </span>
                </div>
              )}
              <div>
                <span className="font-medium text-muted-foreground">Fecha:</span>{" "}
                <span className="text-foreground">
                  {formatMx(startAt, "EEEE d 'de' MMMM, yyyy", { locale: es })}
                </span>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Horario:</span>{" "}
                <span className="text-foreground">
                  {formatMx(startAt, "HH:mm")} - {formatMx(endAt, "HH:mm")}
                </span>
                <p className="text-xs text-muted-foreground">{MX_TIME_NOTE}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Estado:</span>
                <span className={cn("flex items-center gap-1", status.className)}>
                  <status.Icon className="h-4 w-4" /> {statusLabel}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {/* Message when cancelled */}
              {(cancelled || appointment.status === "cancelled") && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                  Tu cita fue cancelada. Puedes reagendar a continuación.
                </p>
              )}

              {!isCancelled && !canCancel && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                  {appointment.status === "completed"
                    ? "Esta consulta ya se realizó."
                    : "Esta cita ya pasó, por eso ya no se puede cancelar ni reagendar desde aquí."}
                </p>
              )}

              {/* Cancelar — solo citas vigentes */}
              {canCancel && (
                <>

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
                          {formatMx(startAt, "d 'de' MMMM", { locale: es })} a las{" "}
                          {formatMx(startAt, "HH:mm")} (hora del centro de México) será cancelada.
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
                </>
              )}

              {/* Reschedule — not for completed consultations or appointments
                  whose time already passed (manage-reschedule rejects those). */}
              {canReschedule && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowReschedule(!showReschedule)}
                >
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Reagendar cita
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Reschedule section — always visible when showReschedule is true */}
        {showReschedule && (
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
                  disabled={(date) => isBeforeMexicoToday(date)}
                  today={mxToday}
                  defaultMonth={mxToday}
                  locale={es}
                  labels={CALENDAR_LABELS_ES}
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
                  <p className="text-xs text-muted-foreground">{MX_TIME_NOTE}</p>
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
