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
import { Building2, FlaskConical, Send } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  appointmentId: string;
  onSuccess: () => void;
}

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
      return (data ?? []) as any[];
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
      return (data ?? []) as any[];
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
        } as any)
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
              patient_name: (appt as any)?.patients?.full_name,
              patient_phone: (appt as any)?.patients?.phone,
              doctor_name: (appt as any)?.doctors?.full_name,
              start_at: (appt as any)?.start_at,
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
      setDestId("");
      onSuccess();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar Informe</DialogTitle>
          <DialogDescription>Selecciona el destino del informe médico.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Destination type */}
          <div className="space-y-2">
            <Label>Tipo de destino</Label>
            <div className="flex gap-2">
              <Button
                variant={destType === "hospital" ? "default" : "outline"}
                size="sm"
                className="gap-2 flex-1"
                onClick={() => { setDestType("hospital"); setDestId(""); }}
              >
                <Building2 className="h-4 w-4" />
                Hospital
              </Button>
              <Button
                variant={destType === "laboratory" ? "default" : "outline"}
                size="sm"
                className="gap-2 flex-1"
                onClick={() => { setDestType("laboratory"); setDestId(""); }}
              >
                <FlaskConical className="h-4 w-4" />
                Laboratorio
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{destType === "hospital" ? "Seleccionar hospital" : "Seleccionar laboratorio"}</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
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
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    Sin resultados
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || !destId}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {sendMut.isPending ? "Enviando…" : "Confirmar y enviar informe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
