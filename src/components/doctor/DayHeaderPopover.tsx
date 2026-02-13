import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Ban, Check } from "lucide-react";
import { toast } from "sonner";

interface DayHeaderPopoverProps {
  day: Date;
  doctorId: string;
  children: React.ReactNode;
}

export default function DayHeaderPopover({ day, doctorId, children }: DayHeaderPopoverProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const dateStr = format(day, "yyyy-MM-dd");

  const { data: override, isLoading } = useQuery({
    queryKey: ["date-override", doctorId, dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_date_overrides")
        .select("*")
        .eq("doctor_id", doctorId)
        .eq("override_date", dateStr)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!doctorId,
  });

  const isBlocked = override?.is_available === false;

  const blockDay = useMutation({
    mutationFn: async () => {
      if (override) {
        const { error } = await supabase
          .from("doctor_date_overrides")
          .update({ is_available: false, note: note || null })
          .eq("id", override.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("doctor_date_overrides")
          .insert({ doctor_id: doctorId, override_date: dateStr, is_available: false, note: note || null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["date-override", doctorId, dateStr] });
      toast.success("Día bloqueado");
      setOpen(false);
      setNote("");
    },
    onError: () => toast.error("Error al bloquear el día"),
  });

  const unblockDay = useMutation({
    mutationFn: async () => {
      if (!override) return;
      const { error } = await supabase
        .from("doctor_date_overrides")
        .delete()
        .eq("id", override.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["date-override", doctorId, dateStr] });
      toast.success("Día desbloqueado");
      setOpen(false);
      setNote("");
    },
    onError: () => toast.error("Error al desbloquear el día"),
  });

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v && override?.note) setNote(override.note); else if (!v) setNote(""); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="center">
        <p className="text-sm font-semibold capitalize mb-2">
          {format(day, "EEEE d MMMM", { locale: es })}
        </p>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando...</p>
        ) : isBlocked ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive flex items-center gap-1">
              <Ban className="h-3 w-3" /> Día bloqueado
            </p>
            {override?.note && (
              <p className="text-xs text-muted-foreground">{override.note}</p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => unblockDay.mutate()}
              disabled={unblockDay.isPending}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Desbloquear día
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="block-note" className="text-xs">Nota (opcional)</Label>
            <Textarea
              id="block-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: Vacaciones, congreso..."
              className="h-16 text-xs"
              maxLength={200}
            />
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => blockDay.mutate()}
              disabled={blockDay.isPending}
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              Bloquear día
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
