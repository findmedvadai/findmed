import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
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

interface AppointmentData {
  appointment_id: string;
  doctor_name: string;
  doctor_address: string | null;
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

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tu cita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
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
                {cancelled ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" /> Cancelada
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" /> Activa
                  </span>
                )}
              </div>
            </div>

            {!cancelled && (
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
