// Bandeja de WhatsApp: el canal conversacional de WHAAPY embebido al 75 % de
// zoom para que quepa más conversación en pantalla. WHAAPY no bloquea el
// embebido (sin X-Frame-Options ni frame-ancestors, verificado 13-oct-2026);
// la sesión de WHAAPY se inicia dentro del recuadro la primera vez.
import { useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const INBOX_URL = "https://app.whaapy.com/inbox";
const ZOOM = 0.75;

export default function WhatsApp() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-[480px] flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-4">
        <p className="truncate text-xs text-muted-foreground">
          Bandeja de WHAAPY. Si te pide iniciar sesión, hazlo aquí mismo; la conversación del agente y la de tu equipo se ven juntas.
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw className="h-3.5 w-3.5" /> Recargar
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
            <a href={INBOX_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Abrir en pestaña nueva
            </a>
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <iframe
          key={reloadKey}
          title="Bandeja de WhatsApp (WHAAPY)"
          src={INBOX_URL}
          className="absolute left-0 top-0 border-0"
          style={{
            width: `${100 / ZOOM}%`,
            height: `${100 / ZOOM}%`,
            transform: `scale(${ZOOM})`,
            transformOrigin: "0 0",
          }}
          allow="clipboard-read; clipboard-write; microphone; camera; autoplay; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
