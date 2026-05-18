// Per-office calendar connector. Each office can have AT MOST one external
// calendar — Google or Outlook, mutually exclusive. Connecting one when the
// other is already connected pops a confirmation dialog and replaces it.
//
// The user always sees an explicit "Desconectar" button when a calendar is
// connected, no need to discover that disconnecting must happen via reconnect.
//
// We hide the raw calendar_id from the UI (it's a noisy implementation detail)
// and show only the connection state plus, when available, the friendly
// calendar name returned by the provider's list endpoint.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

type Provider = "google" | "outlook";

export default function OfficeCalendarConnector({ office }: Props) {
  const queryClient = useQueryClient();
  const invalidateOffices = () =>
    queryClient.invalidateQueries({ queryKey: ["doctor-offices", office.doctor_id] });

  // Patch a single office field in the cache without triggering a full
  // refetch — avoids the momentary empty-list flash that refetch causes
  // on sibling OfficeCalendarConnector instances.
  const patchOfficeCache = (patch: Record<string, unknown>) => {
    const key = ["doctor-offices", office.doctor_id];
    queryClient.setQueryData(key, (old: unknown) => {
      if (!Array.isArray(old)) return old;
      return old.map((o: { id: string }) =>
        o.id === office.id ? { ...o, ...patch } : o
      );
    });
  };

  // Per-provider state.
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [hasOutlookToken, setHasOutlookToken] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<CalendarEntry[]>([]);
  const [outlookCalendars, setOutlookCalendars] = useState<CalendarEntry[]>([]);
  const [googleSelected, setGoogleSelected] = useState("");
  const [outlookSelected, setOutlookSelected] = useState("");
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingOutlook, setLoadingOutlook] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingOutlook, setConnectingOutlook] = useState(false);

  // XOR confirmation: shown when the user clicks "Conectar X" while Y is
  // already connected.
  const [confirmReplace, setConfirmReplace] = useState<Provider | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<Provider | null>(null);

  // Friendly names of currently selected calendars.
  const [googleCalendarName, setGoogleCalendarName] = useState<string | null>(null);
  const [outlookCalendarName, setOutlookCalendarName] = useState<string | null>(null);

  // Detect "we have a refresh_token but no calendar_id yet" — that's the
  // post-OAuth, pre-pick state.
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

  useEffect(() => {
    if (hasGoogleToken && googleCalendars.length === 0 && !loadingGoogle) {
      void fetchGoogleList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGoogleToken]);
  useEffect(() => {
    if (hasOutlookToken && outlookCalendars.length === 0 && !loadingOutlook) {
      void fetchOutlookList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOutlookToken]);

  // When the office is connected, eagerly load both the friendly name AND
  // the full calendars list. Without this the Select trigger renders empty
  // because Radix can't match `value=calendar_id` against an empty list of
  // SelectItem children — the doctor sees an empty field even though a
  // calendar IS saved in DB. We resolve both on mount and after `connected`
  // flips, so the dropdown is populated before the user clicks.
  useEffect(() => {
    if (
      office.google_calendar_connected &&
      office.google_calendar_id &&
      googleCalendars.length === 0 &&
      !loadingGoogle
    ) {
      void resolveCalendarName("google");
    }
    if (
      office.outlook_calendar_connected &&
      office.outlook_calendar_id &&
      outlookCalendars.length === 0 &&
      !loadingOutlook
    ) {
      void resolveCalendarName("outlook");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    office.google_calendar_connected,
    office.google_calendar_id,
    office.outlook_calendar_connected,
    office.outlook_calendar_id,
  ]);

  const callList = async (provider: Provider): Promise<CalendarEntry[]> => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(
      `${supabaseUrl}/functions/v1/${provider}-calendar-list?office_id=${office.id}`,
      { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Error");
    return (data.calendars || []) as CalendarEntry[];
  };

  // Loads the calendars list AND resolves the friendly name in one shot. We
  // populate `googleCalendars` / `outlookCalendars` so the Radix Select can
  // match `value=calendar_id` against a SelectItem and render its label —
  // without the list the trigger renders empty. The friendly name is a
  // fallback used in the SelectValue placeholder.
  const resolveCalendarName = async (provider: Provider) => {
    if (provider === "google") setLoadingGoogle(true);
    else setLoadingOutlook(true);
    try {
      const cals = await callList(provider);
      if (provider === "google") setGoogleCalendars(cals);
      else setOutlookCalendars(cals);
      const targetId =
        provider === "google" ? office.google_calendar_id : office.outlook_calendar_id;
      const found = cals.find((c) => c.id === targetId);
      if (provider === "google") setGoogleCalendarName(found?.summary ?? null);
      else setOutlookCalendarName(found?.summary ?? null);
    } catch {
      // Silent — friendly name is best-effort. If the refresh token is broken
      // the shared backend helper has already auto-disconnected the office,
      // so the next render will show the "Conectar" button instead.
    } finally {
      if (provider === "google") setLoadingGoogle(false);
      else setLoadingOutlook(false);
    }
  };

  const fetchGoogleList = async () => {
    setLoadingGoogle(true);
    try {
      const cals = await callList("google");
      setGoogleCalendars(cals);
      const primary = cals.find((c) => c.primary);
      if (primary) setGoogleSelected(primary.id);
      else if (cals.length > 0) setGoogleSelected(cals[0].id);
    } catch {
      toast.error("Error al cargar calendarios de Google");
    } finally {
      setLoadingGoogle(false);
    }
  };

  const fetchOutlookList = async () => {
    setLoadingOutlook(true);
    try {
      const cals = await callList("outlook");
      setOutlookCalendars(cals);
      const primary = cals.find((c) => c.primary);
      if (primary) setOutlookSelected(primary.id);
      else if (cals.length > 0) setOutlookSelected(cals[0].id);
    } catch {
      toast.error("Error al cargar calendarios de Outlook");
    } finally {
      setLoadingOutlook(false);
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

  const saveCalendar = async (provider: Provider) => {
    try {
      const id = provider === "google" ? googleSelected : outlookSelected;
      const cals = provider === "google" ? googleCalendars : outlookCalendars;
      const friendly = cals.find((c) => c.id === id)?.summary ?? null;
      await callUpdate({
        office_id: office.id,
        ...(provider === "google"
          ? { google_calendar_id: id, google_calendar_connected: true }
          : { outlook_calendar_id: id, outlook_calendar_connected: true }),
      });
      toast.success(`Calendario de ${provider === "google" ? "Google" : "Outlook"} conectado`);
      if (provider === "google") {
        setGoogleCalendars([]);
        setHasGoogleToken(false);
        setGoogleCalendarName(friendly);
      } else {
        setOutlookCalendars([]);
        setHasOutlookToken(false);
        setOutlookCalendarName(friendly);
      }
      invalidateOffices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Swap the connected calendar within the same account (same refresh token).
  // Uses setQueryData (not invalidate) so sibling connector cards don't flash.
  const switchCalendar = async (provider: Provider, newId: string) => {
    if (!newId) return;
    const currentId =
      provider === "google" ? office.google_calendar_id : office.outlook_calendar_id;
    if (currentId === newId) return;
    try {
      await callUpdate({
        office_id: office.id,
        ...(provider === "google"
          ? { google_calendar_id: newId }
          : { outlook_calendar_id: newId }),
      });
      const cals = provider === "google" ? googleCalendars : outlookCalendars;
      const friendly = cals.find((c) => c.id === newId)?.summary ?? null;
      if (provider === "google") setGoogleCalendarName(friendly);
      else setOutlookCalendarName(friendly);
      toast.success("Calendario actualizado");
      // Patch only this office's calendar_id in the cache — avoids a full
      // refetch that would blank out the sibling office's picker briefly.
      patchOfficeCache(
        provider === "google"
          ? { google_calendar_id: newId }
          : { outlook_calendar_id: newId }
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const performDisconnect = async (provider: Provider) => {
    try {
      await callUpdate({
        office_id: office.id,
        ...(provider === "google" ? { disconnect_google: true } : { disconnect_outlook: true }),
      });
      toast.success(provider === "google" ? "Google desconectado" : "Outlook desconectado");
      if (provider === "google") {
        setGoogleCalendars([]);
        setHasGoogleToken(false);
        setGoogleCalendarName(null);
      } else {
        setOutlookCalendars([]);
        setHasOutlookToken(false);
        setOutlookCalendarName(null);
      }
      invalidateOffices();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const startOAuth = async (provider: Provider) => {
    if (provider === "google") setConnectingGoogle(true);
    else setConnectingOutlook(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      // Pass current frontend origin so the callback can redirect back to this
      // dev host instead of falling back to the production SITE_URL.
      const params = new URLSearchParams({
        office_id: office.id,
        origin: window.location.origin,
      });
      const res = await fetch(`${supabaseUrl}/functions/v1/${provider}-calendar-auth?${params}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error");
      const popup = window.open(
        data.url,
        `${provider}-calendar-auth`,
        "width=520,height=720,scrollbars=yes"
      );
      const expectedMessage = `${provider}-calendar-connected`;
      const finish = () => {
        if (provider === "google") {
          setConnectingGoogle(false);
          setHasGoogleToken(true);
        } else {
          setConnectingOutlook(false);
          setHasOutlookToken(true);
        }
        invalidateOffices();
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.data === expectedMessage) {
          window.removeEventListener("message", handleMessage);
          finish();
        }
      };
      window.addEventListener("message", handleMessage);
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          window.removeEventListener("message", handleMessage);
          finish();
        }
      }, 500);
    } catch (err) {
      toast.error((err as Error).message);
      if (provider === "google") setConnectingGoogle(false);
      else setConnectingOutlook(false);
    }
  };

  const handleConnectClick = (provider: Provider) => {
    const otherConnected =
      provider === "google" ? office.outlook_calendar_connected : office.google_calendar_connected;
    if (otherConnected) {
      setConfirmReplace(provider);
    } else {
      void startOAuth(provider);
    }
  };

  const confirmReplaceHandler = async () => {
    if (!confirmReplace) return;
    const target = confirmReplace;
    setConfirmReplace(null);
    const other: Provider = target === "google" ? "outlook" : "google";
    await performDisconnect(other);
    await startOAuth(target);
  };

  const renderProviderCard = (
    provider: Provider,
    label: string,
    isConnected: boolean,
    hasToken: boolean,
    cals: CalendarEntry[],
    selected: string,
    setSelected: (s: string) => void,
    connecting: boolean,
    loadingList: boolean,
    friendlyName: string | null
  ) => {
    return (
      <Card className="flex-1 min-w-0">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{label}</p>
            {isConnected && (
              <span className="inline-flex items-center gap-1 text-xs text-confirmed">
                <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
              </span>
            )}
          </div>

          {isConnected ? (
            <>
              {/* Show the connected calendar name + a picker to swap to a
                  different calendar from the same account, no re-OAuth. */}
              <Select
                value={
                  provider === "google"
                    ? office.google_calendar_id ?? ""
                    : office.outlook_calendar_id ?? ""
                }
                onValueChange={(v) => switchCalendar(provider, v)}
                onOpenChange={(o) => {
                  if (!o) return;
                  // Lazy-load the list when the user opens the picker.
                  const cached = provider === "google" ? googleCalendars : outlookCalendars;
                  if (cached.length === 0) {
                    if (provider === "google") void fetchGoogleList();
                    else void fetchOutlookList();
                  }
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  {/* Radix Select renders empty when `value` exists but no
                      matching <SelectItem> is mounted (e.g. before the list
                      loads or if the list endpoint failed). Passing children
                      to SelectValue guarantees the trigger always shows
                      either the friendly name or a fallback label. */}
                  <SelectValue placeholder={friendlyName ?? "Calendario conectado"}>
                    {friendlyName ?? "Calendario conectado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(provider === "google" ? googleCalendars : outlookCalendars).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (Principal)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => setConfirmDisconnect(provider)}
              >
                <Unplug className="h-4 w-4" /> Desconectar
              </Button>
            </>
          ) : hasToken ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Selecciona el calendario donde se sincronizarán las citas:
              </p>
              {loadingList ? (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
                </p>
              ) : cals.length > 0 ? (
                <div className="space-y-2">
                  <Select value={selected} onValueChange={setSelected}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cals.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.summary}
                          {c.primary ? " (Principal)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-1"
                      disabled={!selected}
                      onClick={() => saveCalendar(provider)}
                    >
                      Usar este calendario
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => performDisconnect(provider)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => performDisconnect(provider)}
                  className="w-full"
                >
                  No hay calendarios — desconectar
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              disabled={connecting}
              onClick={() => handleConnectClick(provider)}
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              {connecting ? "Conectando…" : `Conectar ${label}`}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <div className="flex gap-3 flex-col sm:flex-row">
        {renderProviderCard(
          "google",
          "Google Calendar",
          office.google_calendar_connected,
          hasGoogleToken,
          googleCalendars,
          googleSelected,
          setGoogleSelected,
          connectingGoogle,
          loadingGoogle,
          googleCalendarName
        )}
        {renderProviderCard(
          "outlook",
          "Outlook Calendar",
          office.outlook_calendar_connected,
          hasOutlookToken,
          outlookCalendars,
          outlookSelected,
          setOutlookSelected,
          connectingOutlook,
          loadingOutlook,
          outlookCalendarName
        )}
      </div>

      <AlertDialog open={!!confirmReplace} onOpenChange={(o) => !o && setConfirmReplace(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reemplazar calendario conectado</AlertDialogTitle>
            <AlertDialogDescription>
              Ya tienes {confirmReplace === "google" ? "Outlook" : "Google"} conectado en este
              consultorio. Conectar {confirmReplace === "google" ? "Google" : "Outlook"} reemplazará
              al actual. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplaceHandler}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDisconnect} onOpenChange={(o) => !o && setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desconectar {confirmDisconnect === "google" ? "Google" : "Outlook"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Las citas existentes no se ven afectadas, pero las nuevas no se sincronizarán hasta
              que vuelvas a conectar un calendario.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDisconnect) void performDisconnect(confirmDisconnect);
                setConfirmDisconnect(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
