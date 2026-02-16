import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Clock, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface SessionData {
  session_id: string;
  doctor_id: string;
  patient_id: string;
  doctor_name: string;
  doctor_address: string | null;
  patient_name: string;
  symptoms: string | null;
}

export default function Reserva() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [slots, setSlots] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<{
    manage_url: string;
    doctor_name: string;
    start_at: string;
    end_at: string;
  } | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setError("Enlace inválido. No se proporcionó un token.");
      setLoading(false);
      return;
    }

    fetch(`${SUPABASE_URL}/functions/v1/reserve-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setSession(data);
        }
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate || !session) return;
    setLoadingSlots(true);
    setSelectedSlot(null);

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    fetch(`${SUPABASE_URL}/functions/v1/reserve-slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ doctor_id: session.doctor_id, date: dateStr }),
    })
      .then((res) => res.json())
      .then((data) => {
        setSlots(data.slots || []);
        setDurationMinutes(data.duration_minutes || 30);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, session]);

  const handleBook = async () => {
    if (!session || !selectedDate || !selectedSlot) return;
    setBooking(true);

    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/reserve-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({
          session_id: session.session_id,
          slot_start: selectedSlot,
          date: dateStr,
        }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setBooked({
          manage_url: data.manage_url,
          doctor_name: data.doctor_name,
          start_at: data.start_at,
          end_at: data.end_at,
        });
      }
    } catch {
      toast.error("Error al reservar la cita");
    } finally {
      setBooking(false);
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

  if (booked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">¡Cita reservada!</h2>
            <div className="text-sm text-muted-foreground space-y-1">
              <p><span className="font-medium text-foreground">Doctor:</span> {booked.doctor_name}</p>
              <p>
                <span className="font-medium text-foreground">Fecha:</span>{" "}
                {format(new Date(booked.start_at), "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </p>
              <p>
                <span className="font-medium text-foreground">Horario:</span>{" "}
                {format(new Date(booked.start_at), "HH:mm")} - {format(new Date(booked.end_at), "HH:mm")}
              </p>
            </div>
            <a
              href={booked.manage_url}
              className="inline-block mt-4 text-primary underline text-sm"
            >
              Gestionar mi cita
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Doctor header */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{session.doctor_name}</CardTitle>
            {session.doctor_address && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{session.doctor_address}</span>
              </div>
            )}
          </CardHeader>
        </Card>

        {/* Date picker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Selecciona una fecha</CardTitle>
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

        {/* Time slots */}
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
                <div className="mt-4 pt-4 border-t space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Cita de {durationMinutes} minutos a las <span className="font-medium text-foreground">{selectedSlot}</span>
                  </p>
                  <Button
                    className="w-full"
                    onClick={handleBook}
                    disabled={booking}
                  >
                    {booking ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Reservando...
                      </>
                    ) : (
                      "Confirmar reserva"
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
