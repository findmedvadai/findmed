// Per-office Google + Outlook calendar connector. Mirrors the pre-mejora-2
// flow on Configuracion.tsx but replicated for each office.
//
// Each office can connect to a Google calendar OR an Outlook calendar.
// Connecting Outlook clears Google for that office (and vice versa) — see
// the callback Edge Functions.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Link2, Unlink, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

interface OfficeRow {
  id: string;
  doctor_id: string;
  google_calendar_connected: boolean;
  google_calendar_id: string | null;
  outlook_calendar_connected: boolean;
  outlook_calendar_id: string | null;
}

interface CalendarEntry {
  id: string;
  summary: string;
  primary: boolean;
}

interface Props {
  office: OfficeRow;
}

export default function OfficeCalendarConnector({ office }: Props) {
  const queryClient = useQueryClient();

  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<CalendarEntry[]>([]);
  const [googleSelected, setGoogleSelected] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  const [outlookConnecting, setOutlookConnecting] = useState(false);
  const [outlookCalendars, setOutlookCalendars] = useState<CalendarEntry[]>([]);
  const [outlookSelected, setOutlookSelected] = useState("");
  const [outlookLoading, setOutlookLoading] = useState(false);

  // The "needs to pick a calendar" state: refresh token stored but no
  // calendar_id yet. We detect it by passing through the office row props,
  // which OfficeManager keeps fresh. To know whether a refresh token exists
  // we re-fetch.
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [hasOutlookToken, setHasOutlookToken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("doctor_offices")
        .select("google_refresh_token_ref, outlook_refresh_token_ref")
        .eq("id", office.id)
        .maybeSingle();
      if (cancelled || !data) return;
      setHasGoogleToken(Boolean(data.google_refresh_token_ref) && !office.google_calendar_connected);
      setHasOutlookToken(Boolean(data.outlook_refresh_token_ref) && !office.outlook_calendar_connected);
    })();
    return () => {
      cancelled = true;
    };
  }, [office.id, office.google_calendar_connected, office.outlook_calendar_connected]);

  // Auto-fetch calendar lists when token-but-no-calendar.
  useEffect(() => {
    if (hasGoogleToken && googleCalendars.length === 0 && !googleLoading) {
      fetchGoogleList();
    }
  }, [hasGoogleToken]);
  useEffect(() => {
    if (hasOutlookToken && outlookCalendars.length === 0 && !outlookLoading) {
      fetchOutlookList();
    }
  }, [hasOutlookToken]);

  const invalidateOffices = () =>
    queryClient.invalidateQueries({ queryKey: ["doctor-offices", office.doctor_id] });

  const fetchGoogleList = async () => {
    setGoogleLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/google-calendar-list?office_id=${office.id}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error");
      const cals = data.calendars || [];
      setGoogleCalendars(cals);
      const primary = cals.find((c: CalendarEntry) => c.primary);
      if (primary) setGoogleSelected(primary.id);
      else if (cals.length > 0) setGoogleSelected(cals[0].id);
    } catch (err) {
      toast.error("Error al cargar calendarios de Google");
    } finally {
      setGoogleLoading(false);
    }
  };

  const fetchOutlookList = async () => {
    setOutlookLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/outlook-calendar-list?office_id=${office.id}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error");
      const cals = data.calendars || [];
      setOutlookCalendars(cals);
      const primary = cals.find((c: CalendarEntry) => c.primary);
      if (primary) setOutlookSelected(primary.id);
      else if (cals.length > 0) setOutlookSelected(cals[0].id);
    } catch (err) {
      toast.error("Error al cargar calendarios de Outlook");
    } finally {
      setOutlookLoading(false);
    }
  };

  const callUpdate = async (body: Record<string, unknown>) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/doctor-office-update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Error");
    return data;
  };

  const saveGoogleCalendar = async () => {
    try {
      await callUpdate({
        office_id: office.id,
        google_calendar_id: googleSelected,
        google_calendar_connected: true,
      });
      toast.success("Calendario de Google seleccionado");
      setGoogleCalendars([]);
      setHasGoogleToken(false);
      invalidateOffices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const saveOutlookCalendar = async () => {
    try {
      await callUpdate({
        office_id: office.id,
        outlook_calendar_id: outlookSelected,
        outlook_calendar_connected: true,
      });
      toast.success("Calendario de Outlook seleccionado");
      setOutlookCalendars([]);
      setHasOutlookToken(false);
      invalidateOffices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const disconnect = async (provider: "google" | "outlook") => {
    try {
      await callUpdate({
        office_id: office.id,
        ...(provider === "google" ? { disconnect_google: true } : { disconnect_outlook: true }),
      });
      toast.success(provider === "google" ? "Google desconectado" : "Outlook desconectado");
      if (provider === "google") {
        setGoogleCalendars([]);
        setHasGoogleToken(false);
      } else {
        setOutlookCalendars([]);
        setHasOutlookToken(false);
      }
      invalidateOffices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const startGoogleOAuth = async () => {
    setGoogleConnecting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/google-calendar-auth?office_id=${office.id}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error");
      const popup = window.open(data.url, "google-calendar-auth", "width=500,height=700,scrollbars=yes");
      const handleMessage = (event: MessageEvent) => {
        if (event.data === "google-calendar-connected") {
          window.removeEventListener("message", handleMessage);
          setGoogleConnecting(false);
          setHasGoogleToken(true);
          invalidateOffices();
        }
      };
      window.addEventListener("message", handleMessage);
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          window.removeEventListener("message", handleMessage);
          setGoogleConnecting(false);
          setHasGoogleToken(true);
          invalidateOffices();
        }
      }, 500);
    } catch (err) {
      toast.error((err as Error).message);
      setGoogleConnecting(false);
    }
  };

  const startOutlookOAuth = async () => {
    setOutlookConnecting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/outlook-calendar-auth?office_id=${office.id}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error");
      const popup = window.open(data.url, "outlook-calendar-auth", "width=500,height=700,scrollbars=yes");
      const handleMessage = (event: MessageEvent) => {
        if (event.data === "outlook-calendar-connected") {
          window.removeEventListener("message", handleMessage);
          setOutlookConnecting(false);
          setHasOutlookToken(true);
          invalidateOffices();
        }
      };
      window.addEventListener("message", handleMessage);
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          window.removeEventListener("message", handleMessage);
          setOutlookConnecting(false);
          setHasOutlookToken(true);
          invalidateOffices();
        }
      }, 500);
    } catch (err) {
      toast.error((err as Error).message);
      setOutlookConnecting(false);
    }
  };

  const renderProvider = (
    label: string,
    isConnected: boolean,
    calendarId: string | null,
    hasToken: boolean,
    calendars: CalendarEntry[],
    selected: string,
    setSelected: (s: string) => void,
    onConnect: () => void,
    connecting: boolean,
    onSaveCal: () => void,
    onDisconnect: () => void,
    loadingList: boolean
  ) => (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {isConnected ? (
        <div className="flex items-center justify-between rounded-md border border-confirmed/30 bg-confirmed/5 p-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-confirmed" />
            <span className="font-medium">Conectado</span>
            {calendarId && <span className="text-xs text-muted-foreground truncate">{calendarId}</span>}
          </div>
          <Button variant="outline" size="sm" className="gap-1 h-7" onClick={onDisconnect}>
            <Unlink className="h-3 w-3" /> Desconectar
          </Button>
        </div>
      ) : hasToken ? (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <p className="text-xs">Cuenta vinculada — selecciona un calendario:</p>
          {loadingList ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
            </p>
          ) : calendars.length > 0 ? (
            <div className="flex gap-2">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (Principal)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 gap-1" disabled={!selected} onClick={onSaveCal}>
                <Save className="h-3 w-3" /> Usar
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              Cancelar y desconectar
            </Button>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" className="gap-1" onClick={onConnect} disabled={connecting}>
          {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
          {connecting ? "Conectando…" : `Conectar ${label}`}
        </Button>
      )}
    </div>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {renderProvider(
        "Google Calendar",
        office.google_calendar_connected,
        office.google_calendar_id,
        hasGoogleToken,
        googleCalendars,
        googleSelected,
        setGoogleSelected,
        startGoogleOAuth,
        googleConnecting,
        saveGoogleCalendar,
        () => disconnect("google"),
        googleLoading
      )}
      {renderProvider(
        "Outlook Calendar",
        office.outlook_calendar_connected,
        office.outlook_calendar_id,
        hasOutlookToken,
        outlookCalendars,
        outlookSelected,
        setOutlookSelected,
        startOutlookOAuth,
        outlookConnecting,
        saveOutlookCalendar,
        () => disconnect("outlook"),
        outlookLoading
      )}
    </div>
  );
}
