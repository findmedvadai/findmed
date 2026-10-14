import { useCallback, useEffect, useState } from "react";
import { type BrowserAlertPermission, browserAlertPermission, requestBrowserAlerts } from "@/lib/browser-alerts";

/** Estado del permiso de notificaciones del navegador y cómo pedirlo (desde un clic). */
export function useBrowserAlertPermission() {
  const [permission, setPermission] = useState<BrowserAlertPermission>(() => browserAlertPermission());

  useEffect(() => {
    const sync = () => setPermission(browserAlertPermission());
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((s) => {
        status = s;
        s.onchange = sync;
      })
      .catch(() => {});
    // Si la persona lo cambia desde la configuración del sitio, al volver a la pestaña se refleja.
    window.addEventListener("focus", sync);
    return () => {
      if (status) status.onchange = null;
      window.removeEventListener("focus", sync);
    };
  }, []);

  const request = useCallback(async () => {
    const p = await requestBrowserAlerts();
    setPermission(p);
    return p;
  }, []);

  return { permission, request };
}
