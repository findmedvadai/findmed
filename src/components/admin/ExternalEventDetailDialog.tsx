import { es } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Info, Stethoscope } from "lucide-react";
import { SoftBadge } from "@/components/app/StatusBadge";
import { formatMx } from "@/lib/timezone";

export interface ExternalEvent {
  id: string;
  provider: "google" | "outlook";
  title: string;
  start: Date;
  end: Date;
  description?: string | null;
  doctorName?: string;
  htmlLink?: string;
}

interface Props {
  event: ExternalEvent | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Read-only viewer for events that live on the doctor's external calendar
 * (Google or Outlook). The admin cannot edit or cancel these — only the doctor
 * can, from their own Agenda view. The "Open in …" link sends them to the
 * source calendar.
 */
export default function ExternalEventDetailDialog({ event, open, onClose }: Props) {
  if (!event) return null;
  const providerLabel = event.provider === "outlook" ? "Outlook" : "Google";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2 pr-6">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-base">{event.title}</DialogTitle>
            <SoftBadge tone="neutral">{providerLabel} Calendar</SoftBadge>
          </div>
          <DialogDescription className="first-letter:uppercase">
            {formatMx(event.start, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })} ·{" "}
            {formatMx(event.start, "HH:mm")} – {formatMx(event.end, "HH:mm")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {event.doctorName && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <Stethoscope className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Doctor</span>
              <span className="truncate font-medium text-foreground">{event.doctorName}</span>
            </div>
          )}
          {event.description && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">Descripción</h3>
              <p className="whitespace-pre-line text-muted-foreground">{event.description}</p>
            </section>
          )}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            Este evento vive en el calendario externo del doctor. Solo el doctor puede editarlo o eliminarlo
            desde su agenda.
          </p>
        </div>

        {event.htmlLink && (
          <div className="flex justify-end border-t pt-4">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={event.htmlLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Abrir en {providerLabel} Calendar
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
