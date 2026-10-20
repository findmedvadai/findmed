import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Building2, FlaskConical, Send } from "lucide-react";
import { userErrorMessage } from "@/lib/edge-function-error";
import { appointmentPatientName } from "@/lib/patient-name";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  appointmentId: string;
  onSuccess: () => void;
}

const DEST_TYPES = [
  { value: "hospital", label: "Hospital", icon: Building2 },
  { value: "laboratory", label: "Laboratorio", icon: FlaskConical },
] as const;

export default function SendReportModal({ open, onOpenChange, formId, appointmentId, onSuccess }: Props) {
  const [destType, setDestType] = useState<"hospital" | "laboratory">("hospital");
  const [destId, setDestId] = useState("");

  const { data: hospitals } = useQuery({
    queryKey: ["active-hospitals"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hospitals")
        .select("id, name, city_id, zone_id, cities(name), zones(name)")
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const { data: laboratories } = useQuery({
    queryKey: ["active-laboratories"],
    queryFn: async () => {
      const { data } = await supabase
        .from("laboratories")
        .select("id, name, city_id, zone_id, cities(name), zones(name)")
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const options = destType === "hospital" ? hospitals : laboratories;

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!destId) throw new Error("Selecciona un destino");

      // Update form
      const { error } = await supabase
        .from("post_consultation_forms")
        .update({
          review_status: "report_sent",
          report_destination_type: destType,
          report_destination_id: destId,
          report_sent_at: new Date().toISOString(),
        })
        .eq("id", formId);
      if (error) throw error;

      // Get full data for webhook
      const { data: formData } = await supabase
        .from("post_consultation_forms")
        .select("*")
        .eq("id", formId)
        .single();

      const { data: appt } = await supabase
        .from("appointments")
        .select("*, patients(full_name, phone), doctors(full_name)")
        .eq("id", appointmentId)
        .single();

      // Get destination info
      const table = destType === "hospital" ? "hospitals" : "laboratories";
      const { data: dest } = await supabase
        .from(table)
        .select("*, cities(name), zones(name)")
        .eq("id", destId)
        .single();

      // Dispatch webhook
      try {
        await supabase.functions.invoke("dispatch-webhook", {
          body: {
            event_type: "postconsultation.report_sent",
            payload: {
              appointment_id: appointmentId,
              patient_name: appointmentPatientName(appt, null),
              patient_phone: appt?.patients?.phone,
              doctor_name: appt?.doctors?.full_name,
              start_at: appt?.start_at,
              form: formData,
              destination_type: destType,
              destination: dest,
            },
          },
        });
      } catch (e) {
        console.error("Webhook dispatch error:", e);
      }
    },
    onSuccess: () => {
      toast({ title: "Informe enviado" });
      setDestId("");
      onSuccess();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: userErrorMessage(err, "No se pudo completar la acción."), variant: "destructive" }),
  });

  const destLabel = destType === "hospital" ? "Hospital" : "Laboratorio";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-5 sm:max-w-lg">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base font-semibold">Enviar informe</DialogTitle>
          <DialogDescription className="text-sm">
            Elige a qué hospital o laboratorio se envía el informe médico de esta consulta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Destination type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Tipo de destino</Label>
            <div role="group" aria-label="Tipo de destino" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
              {DEST_TYPES.map((t) => {
                const Icon = t.icon;
                const active = destType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setDestType(t.value); setDestId(""); }}
                    className={cn(
                      "flex h-8 items-center justify-center gap-1.5 rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-destination" className="text-xs font-medium">{destLabel}</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger id="report-destination" className="h-9 text-sm">
                <SelectValue placeholder={destType === "hospital" ? "Selecciona un hospital" : "Selecciona un laboratorio"} />
              </SelectTrigger>
              <SelectContent>
                {(options ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                    {item.cities?.name ? ` · ${item.cities.name}` : ""}
                    {item.zones?.name ? ` / ${item.zones.name}` : ""}
                  </SelectItem>
                ))}
                {(options ?? []).length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {destType === "hospital" ? "No hay hospitales activos en el catálogo." : "No hay laboratorios activos en el catálogo."}
                  </div>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">El formulario quedará marcado como «Informe enviado».</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            size="sm"
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || !destId}
            className="gap-1.5"
          >
            <Send className="h-4 w-4" />
            {sendMut.isPending ? "Enviando…" : "Confirmar y enviar informe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
