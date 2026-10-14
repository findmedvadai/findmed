import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { formatMx, mexicoDayLabel } from "@/lib/timezone";
import { supabase } from "@/integrations/supabase/client";
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
  Stethoscope,
  ClipboardList,
  SearchX,
  LifeBuoy,
  Hand,
  AlarmClock,
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
import AppointmentDetailDialog from "@/components/admin/AppointmentDetailDialog";
import PostConsultationDetailDialog from "@/components/admin/PostConsultationDetailDialog";

type NotificationType = Database["public"]["Enums"]["notification_type"];
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const TYPE_CONFIG: Record<NotificationType, { label: string; icon: typeof Bell; tone: Tone }> = {
  appointment_scheduled: { label: "Nueva cita", icon: CalendarPlus, tone: "success" },
  appointment_rescheduled: { label: "Reagendada", icon: CalendarClock, tone: "info" },
  appointment_cancelled_by_patient: { label: "Cancelada por paciente", icon: CalendarX, tone: "danger" },
  appointment_cancelled_by_doctor: { label: "Cancelada por doctor", icon: CalendarX, tone: "danger" },
  appointment_cancelled_by_admin: { label: "Cancelada por FindMed", icon: CalendarX, tone: "danger" },
  appointment_auto_cancelled: { label: "Auto-cancelada", icon: CalendarX, tone: "neutral" },
  appointment_completed: { label: "Completada", icon: CheckCircle2, tone: "info" },
  postconsultation_submitted: { label: "Post-consulta", icon: ClipboardList, tone: "warning" },
  documents_received: { label: "Documentos recibidos", icon: ClipboardList, tone: "success" },
  case_opened: { label: "Caso nuevo", icon: LifeBuoy, tone: "warning" },
  case_handoff: { label: "Pide atención del equipo", icon: Hand, tone: "danger" },
  case_overdue: { label: "Caso sin tomar", icon: AlarmClock, tone: "danger" },
};

const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

const PAGE_SIZE = 25;

const dayLabel = (d: Date) => mexicoDayLabel(d);

function groupByDay<T extends { created_at: string }>(items: T[]) {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const d = parseISO(item.created_at);
    const key = formatMx(d, "yyyy-MM-dd");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(d), items: [item] });
  }
  return groups;
}

const doctorNameOf = (n: NotificationRow) => (n as { doctors?: { full_name?: string | null } | null }).doctors?.full_name ?? null;

function NotificationItem({
  notif,
  doctorName,
  onOpen,
  onMarkRead,
  marking,
}: {
  notif: NotificationRow;
  doctorName: string | null;
  onOpen?: () => void;
  onMarkRead: () => void;
  marking: boolean;
}) {
  const cfg = TYPE_CONFIG[notif.type as NotificationType];
  const Icon = cfg?.icon ?? Bell;
  const tone = cfg?.tone ?? "neutral";
  const unread = !notif.is_read;

  const content = (
    <>
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE_ICON[tone], !unread && "opacity-70")}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cn("truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
            {unread && <span className="sr-only">Sin leer: </span>}
            {notif.title}
          </p>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatMx(parseISO(notif.created_at), "HH:mm")}</span>
        </div>
        {notif.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{notif.body}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <SoftBadge tone={tone}>{cfg?.label ?? notif.type}</SoftBadge>
          {doctorName && (
            <span className="flex min-w-0 items-center gap-1">
              <Stethoscope className="h-3 w-3 shrink-0" />
              <span className="truncate">{doctorName}</span>
            </span>
          )}
          {onOpen && <span className="hidden text-primary group-hover:inline">Ver detalle</span>}
        </div>
      </div>
    </>
  );

  return (
    <li className={cn("group relative flex items-start transition-colors", unread && "bg-primary/[0.03]", onOpen && "hover:bg-accent/40")}>
      {unread && <span className="absolute left-1.5 top-[25px] h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 text-left focus-visible:bg-accent/40 focus-visible:outline-none"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2">{content}</div>
      )}
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
export default function AdminInbox({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [postConsultationAppointmentId, setPostConsultationAppointmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
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
          const doctorSpecs = (n as { doctors?: { doctor_specialties?: { specialty_id: string }[] | null } | null })
            .doctors?.doctor_specialties;
          return doctorSpecs?.some((ds) => ds.specialty_id === specialtyFilter);
        });
      }

      return results;
    },
    // Realtime y "marcar como leída" invalidan esta lista, y cambiar de filtro
    // cambia la llave: la lista anterior sigue visible mientras se recarga.
    placeholderData: keepPreviousData,
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

  const q = searchQuery.trim().toLowerCase();
  const filtered = (notifications ?? []).filter((n) => {
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (!q) return true;
    const doctorName = (doctorNameOf(n) ?? "").toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      (n.body ?? "").toLowerCase().includes(q) ||
      doctorName.includes(q)
    );
  });
  const shown = filtered.slice(0, visible);
  const groups = groupByDay(shown);
  const filtersActive = !!q || typeFilter !== "all" || doctorFilter !== "all" || specialtyFilter !== "all";

  // Cambiar un filtro vuelve a la primera página.
  const withReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setVisible(PAGE_SIZE);
  };
  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setDoctorFilter("all");
    setSpecialtyFilter("all");
    setVisible(PAGE_SIZE);
  };

  const openNotification = (notif: NotificationRow) => {
    // Las alertas de casos abren el caso; el resto, la cita o su formulario.
    if (notif.case_id) {
      if (!notif.is_read) markReadMut.mutate(notif.id);
      navigate(`/admin/casos?caso=${notif.case_id}`);
      return;
    }
    if (!notif.appointment_id) return;
    if (notif.type === "postconsultation_submitted") {
      setPostConsultationAppointmentId(notif.appointment_id);
    } else {
      setSelectedAppointmentId(notif.appointment_id);
    }
    if (!notif.is_read) markReadMut.mutate(notif.id);
  };

  const filterSelectClass = "h-9 min-w-[150px] flex-1 text-sm sm:w-[180px] sm:flex-none";

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title="Notificaciones"
          description={unreadCount > 0 ? `${unreadCount} notificación${unreadCount > 1 ? "es" : ""} sin leer` : "Sin notificaciones nuevas"}
        />
      )}

      <FilterBar>
        <SearchInput value={searchQuery} onChange={withReset(setSearchQuery)} placeholder="Buscar paciente, doctor…" />
        <Select value={typeFilter} onValueChange={withReset(setTypeFilter)}>
          <SelectTrigger className={filterSelectClass} aria-label="Tipo de notificación"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(TYPE_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={doctorFilter} onValueChange={withReset(setDoctorFilter)}>
          <SelectTrigger className={filterSelectClass} aria-label="Doctor"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los doctores</SelectItem>
            {doctors?.map((doc) => (
              <SelectItem key={doc.id} value={doc.id}>
                {doc.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={specialtyFilter} onValueChange={withReset(setSpecialtyFilter)}>
          <SelectTrigger className={filterSelectClass} aria-label="Especialidad"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las especialidades</SelectItem>
            {specialties?.map((spec) => (
              <SelectItem key={spec.id} value={spec.id}>
                {spec.name}
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
            description={q ? "No hay notificaciones que coincidan con tu búsqueda." : "No hay notificaciones con estos filtros."}
            action={<Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Sin notificaciones"
            description="Aquí aparecerán las citas nuevas, cancelaciones y formularios post-consulta."
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
                    doctorName={doctorNameOf(notif)}
                    onOpen={notif.appointment_id || notif.case_id ? () => openNotification(notif) : undefined}
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

      <AppointmentDetailDialog
        appointmentId={selectedAppointmentId}
        open={!!selectedAppointmentId}
        onOpenChange={(open) => {
          if (!open) setSelectedAppointmentId(null);
        }}
      />

      <PostConsultationDetailDialog
        appointmentId={postConsultationAppointmentId}
        open={!!postConsultationAppointmentId}
        onOpenChange={(open) => {
          if (!open) setPostConsultationAppointmentId(null);
        }}
      />
    </div>
  );
}
