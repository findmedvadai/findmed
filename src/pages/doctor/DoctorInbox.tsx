import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isThisYear, isToday, isYesterday, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Inbox,
  CalendarPlus,
  CalendarX,
  CalendarClock,
  CheckCircle2,
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  SearchX,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { cn } from "@/lib/utils";

type NotificationType = Database["public"]["Enums"]["notification_type"];
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const TYPE_CONFIG: Partial<Record<NotificationType, { label: string; icon: typeof Bell; tone: Tone }>> = {
  appointment_scheduled: { label: "Nueva cita", icon: CalendarPlus, tone: "success" },
  appointment_rescheduled: { label: "Reagendada", icon: CalendarClock, tone: "info" },
  appointment_cancelled_by_patient: { label: "Cancelada por paciente", icon: CalendarX, tone: "danger" },
  appointment_cancelled_by_doctor: { label: "Cancelada por doctor", icon: CalendarX, tone: "danger" },
  appointment_cancelled_by_admin: { label: "Cancelada por FindMed", icon: CalendarX, tone: "danger" },
  appointment_auto_cancelled: { label: "Auto-cancelada", icon: CalendarX, tone: "neutral" },
  appointment_completed: { label: "Completada", icon: CheckCircle2, tone: "info" },
  postconsultation_submitted: { label: "Post-consulta", icon: ClipboardList, tone: "warning" },
  documents_received: { label: "Documentos recibidos", icon: ClipboardList, tone: "success" },
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todos los tipos" },
  { value: "appointment_scheduled", label: "Nuevas citas" },
  { value: "appointment_rescheduled", label: "Reagendadas" },
  { value: "appointment_cancelled_by_patient", label: "Canceladas (paciente)" },
  { value: "appointment_cancelled_by_doctor", label: "Canceladas (doctor)" },
  { value: "appointment_cancelled_by_admin", label: "Canceladas (FindMed)" },
  { value: "appointment_auto_cancelled", label: "Auto-canceladas" },
  { value: "appointment_completed", label: "Completadas" },
];

const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

const PAGE_SIZE = 25;

function dayLabel(d: Date) {
  if (isToday(d)) return "Hoy";
  if (isYesterday(d)) return "Ayer";
  const s = format(d, isThisYear(d) ? "EEEE d 'de' MMMM" : "EEEE d 'de' MMMM yyyy", { locale: es });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function groupByDay<T extends { created_at: string }>(items: T[]) {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const d = parseISO(item.created_at);
    const key = format(d, "yyyy-MM-dd");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(d), items: [item] });
  }
  return groups;
}

function NotificationItem({ notif, onMarkRead, marking }: { notif: NotificationRow; onMarkRead: () => void; marking: boolean }) {
  const cfg = TYPE_CONFIG[notif.type as NotificationType];
  const Icon = cfg?.icon ?? Bell;
  const tone = cfg?.tone ?? "neutral";
  const unread = !notif.is_read;

  return (
    <li className={cn("relative flex items-start", unread && "bg-primary/[0.03]")}>
      {unread && <span className="absolute left-1.5 top-[25px] h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
      <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE_ICON[tone], !unread && "opacity-70")}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className={cn("truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
              {unread && <span className="sr-only">Sin leer: </span>}
              {notif.title}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{format(parseISO(notif.created_at), "HH:mm")}</span>
          </div>
          {notif.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{notif.body}</p>}
          <div className="mt-1.5">
            <SoftBadge tone={tone}>{cfg?.label ?? notif.type}</SoftBadge>
          </div>
        </div>
      </div>
      <div className="flex w-11 shrink-0 justify-center pt-3">
        {unread && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onMarkRead}
            disabled={marking}
            aria-label="Marcar como leída"
            title="Marcar como leída"
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

/** embedded: se muestra dentro de otro módulo, sin título propio. */
export default function DoctorInbox({ embedded = false }: { embedded?: boolean } = {}) {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

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

  const q = search.trim().toLowerCase();
  const filtered = (notifications ?? []).filter(
    (n) => !q || n.title.toLowerCase().includes(q) || (n.body ?? "").toLowerCase().includes(q),
  );
  const shown = filtered.slice(0, visible);
  const groups = groupByDay(shown);
  const filtersActive = !!q || typeFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setVisible(PAGE_SIZE);
  };

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title="Notificaciones"
          description={unreadCount > 0 ? `${unreadCount} notificación${unreadCount > 1 ? "es" : ""} sin leer` : "Sin notificaciones nuevas"}
        />
      )}

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Buscar paciente…"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setVisible(PAGE_SIZE);
          }}
        >
          <SelectTrigger className="h-9 w-full text-sm sm:w-[200px]" aria-label="Tipo de notificación">
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
        <div className="flex w-full items-center justify-between gap-3 sm:ml-auto sm:w-auto sm:justify-end">
          <span className="text-xs text-muted-foreground">
            {isLoading ? "" : unreadCount > 0 ? `${unreadCount} sin leer` : "Todo leído"}
          </span>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => markAllReadMut.mutate()}
              disabled={markAllReadMut.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Marcar todo como leído
            </Button>
          )}
        </div>
      </FilterBar>

      {isLoading ? (
        <Card className="overflow-hidden">
          <div className="h-8 border-b bg-muted/40" />
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description={q ? "No hay notificaciones que coincidan con tu búsqueda." : "No hay notificaciones de este tipo."}
            action={<Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Sin notificaciones"
            description="Aquí aparecerán tus citas nuevas, reagendas y cancelaciones."
          />
        )
      ) : (
        <Card className="overflow-hidden">
          {groups.map((g) => (
            <section key={g.key} className="border-b last:border-b-0">
              <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{g.label}</h3>
              <ul className="divide-y">
                {g.items.map((notif) => (
                  <NotificationItem
                    key={notif.id}
                    notif={notif}
                    onMarkRead={() => markReadMut.mutate(notif.id)}
                    marking={markReadMut.isPending}
                  />
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > shown.length && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-2">
              <span className="text-xs text-muted-foreground">
                Mostrando {shown.length} de {filtered.length}
              </span>
              <Button size="sm" variant="ghost" className="h-8 text-primary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Mostrar más
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
