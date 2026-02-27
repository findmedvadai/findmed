import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Inbox,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Bell,
  Check,
  CheckCheck,
  User,
  Stethoscope,
  Search,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";
import AppointmentDetailDialog from "@/components/admin/AppointmentDetailDialog";

type NotificationType = Database["public"]["Enums"]["notification_type"];

const TYPE_CONFIG: Record<
  NotificationType,
  { label: string; icon: typeof Bell; className: string }
> = {
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

export default function AdminInbox() {
  const queryClient = useQueryClient();
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Load doctors with their specialties
  const { data: doctors } = useQuery({
    queryKey: ["inbox-doctors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, full_name, doctor_specialties(specialty_id)")
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load specialties
  const { data: specialties } = useQuery({
    queryKey: ["inbox-specialties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("specialties")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["admin-notifications", doctorFilter, specialtyFilter],
    queryFn: async () => {
      let query = supabase
        .from("notifications")
        .select("*, doctors(full_name, doctor_specialties(specialty_id))")
        .in("recipient_role", ["admin", "superadmin"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (doctorFilter !== "all") {
        query = query.eq("doctor_id", doctorFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      let results = data ?? [];

      // Client-side specialty filter
      if (specialtyFilter !== "all") {
        results = results.filter((n) => {
          const doctorSpecs = (n as any).doctors?.doctor_specialties as
            | { specialty_id: string }[]
            | null;
          return doctorSpecs?.some((ds) => ds.specialty_id === specialtyFilter);
        });
      }

      return results;
    },
  });

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const markReadMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] }),
    onError: () =>
      toast({ title: "Error al marcar como leída", variant: "destructive" }),
  });

  const markAllReadMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("recipient_role", ["admin", "superadmin"])
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Todas marcadas como leídas" });
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
    },
    onError: () =>
      toast({ title: "Error", variant: "destructive" }),
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} notificación${unreadCount > 1 ? "es" : ""} sin leer`
              : "Sin notificaciones nuevas"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por paciente, doctor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="w-48 gap-2">
              <User className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los doctores</SelectItem>
              {doctors?.map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>
                  {doc.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
            <SelectTrigger className="w-48 gap-2">
              <Stethoscope className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las especialidades</SelectItem>
              {specialties?.map((spec) => (
                <SelectItem key={spec.id} value={spec.id}>
                  {spec.name}
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

      {(() => {
        const q = searchQuery.toLowerCase();
        const filtered = q
          ? notifications?.filter((n) => {
              const doctorName = ((n as any).doctors?.full_name ?? "").toLowerCase();
              return (
                n.title.toLowerCase().includes(q) ||
                (n.body ?? "").toLowerCase().includes(q) ||
                doctorName.includes(q)
              );
            })
          : notifications;
        
        return filtered && filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((notif) => {
            const cfg = TYPE_CONFIG[notif.type as NotificationType];
            const Icon = cfg?.icon ?? Bell;
            const created = parseISO(notif.created_at);
            const doctorName = (notif as any).doctors?.full_name;

            return (
              <Card
                key={notif.id}
                className={`transition-all ${
                  notif.is_read
                    ? "opacity-60"
                    : "border-l-4 border-l-primary shadow-sm"
                } ${notif.appointment_id ? "cursor-pointer hover:bg-accent/50" : ""}`}
                onClick={() => {
                  if (notif.appointment_id) {
                    setSelectedAppointmentId(notif.appointment_id);
                    if (!notif.is_read) markReadMut.mutate(notif.id);
                  }
                }}
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
                      <p className="text-sm text-muted-foreground whitespace-pre-line">
                        {notif.body}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {doctorName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {doctorName}
                        </span>
                      )}
                      <span>
                        {format(created, "d MMM yyyy · HH:mm", { locale: es })}
                      </span>
                    </div>
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
              {searchQuery
                ? "No hay resultados para tu búsqueda."
                : doctorFilter !== "all" || specialtyFilter !== "all"
                ? "No hay notificaciones con estos filtros."
                : "Aquí aparecerán las notificaciones administrativas."}
            </p>
          </CardContent>
        </Card>
      );
      })()}

      <AppointmentDetailDialog
        appointmentId={selectedAppointmentId}
        open={!!selectedAppointmentId}
        onOpenChange={(open) => {
          if (!open) setSelectedAppointmentId(null);
        }}
      />
    </div>
  );
}
