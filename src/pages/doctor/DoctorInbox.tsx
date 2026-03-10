import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Inbox,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Bell,
  Check,
  CheckCheck,
  Filter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

type NotificationType = Database["public"]["Enums"]["notification_type"];

const TYPE_CONFIG: Partial<Record<
  NotificationType,
  { label: string; icon: typeof Bell; className: string }
>> = {
  appointment_scheduled: {
    label: "Nueva cita",
    icon: CalendarPlus,
    className: "text-confirmed",
  },
  appointment_cancelled_by_patient: {
    label: "Cancelada (paciente)",
    icon: CalendarX,
    className: "text-destructive",
  },
  appointment_cancelled_by_doctor: {
    label: "Cancelada (doctor)",
    icon: CalendarX,
    className: "text-destructive",
  },
  appointment_auto_cancelled: {
    label: "Auto-cancelada",
    icon: CalendarX,
    className: "text-muted-foreground",
  },
  appointment_completed: {
    label: "Completada",
    icon: CheckCircle2,
    className: "text-primary",
  },
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "appointment_scheduled", label: "Nuevas citas" },
  { value: "appointment_cancelled_by_patient", label: "Canceladas (paciente)" },
  { value: "appointment_cancelled_by_doctor", label: "Canceladas (doctor)" },
  { value: "appointment_auto_cancelled", label: "Auto-canceladas" },
  { value: "appointment_completed", label: "Completadas" },
];

export default function DoctorInbox() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["doctor-notifications", doctorId, typeFilter],
    queryFn: async () => {
      if (!doctorId) return [];
      let query = supabase
        .from("notifications")
        .select("*")
        .eq("doctor_id", doctorId)
        .eq("recipient_role", "doctor")
        .order("created_at", { ascending: false })
        .limit(100);

      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter as NotificationType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!doctorId) return;

    const channel = supabase
      .channel("doctor-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `doctor_id=eq.${doctorId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["doctor-notifications", doctorId],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [doctorId, queryClient]);

  // Mark single as read
  const markReadMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["doctor-notifications", doctorId],
      }),
    onError: () =>
      toast({ title: "Error al marcar como leída", variant: "destructive" }),
  });

  // Mark all as read
  const markAllReadMut = useMutation({
    mutationFn: async () => {
      if (!doctorId) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("doctor_id", doctorId)
        .eq("recipient_role", "doctor")
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Todas marcadas como leídas" });
      queryClient.invalidateQueries({
        queryKey: ["doctor-notifications", doctorId],
      });
    },
    onError: () =>
      toast({ title: "Error", variant: "destructive" }),
  });

  const unreadCount =
    notifications?.filter((n) => !n.is_read).length ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} notificación${unreadCount > 1 ? "es" : ""} sin leer`
              : "Sin notificaciones nuevas"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52 gap-2">
              <Filter className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => markAllReadMut.mutate()}
              disabled={markAllReadMut.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Marcar todas
            </Button>
          )}
        </div>
      </div>

      {/* Notification list */}
      {notifications && notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const cfg = TYPE_CONFIG[notif.type as NotificationType];
            const Icon = cfg?.icon ?? Bell;
            const created = parseISO(notif.created_at);

            return (
              <Card
                key={notif.id}
                className={`transition-all ${
                  notif.is_read
                    ? "opacity-60"
                    : "border-l-4 border-l-primary shadow-sm"
                }`}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <Icon
                    className={`mt-0.5 h-5 w-5 shrink-0 ${cfg?.className ?? "text-muted-foreground"}`}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {notif.title}
                      </p>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {cfg?.label ?? notif.type}
                      </Badge>
                    </div>
                    {notif.body && (
                      <p className="text-sm text-muted-foreground">
                        {notif.body}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {format(created, "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => markReadMut.mutate(notif.id)}
                      disabled={markReadMut.isPending}
                      title="Marcar como leída"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">
              Sin notificaciones
            </p>
            <p className="text-sm text-muted-foreground/70">
              {typeFilter !== "all"
                ? "No hay notificaciones de este tipo."
                : "Aquí aparecerán tus notificaciones de citas."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
