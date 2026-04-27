import { es } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {event.title}
            <Badge variant="outline" className="text-xs">{providerLabel}</Badge>
          </DialogTitle>
          <DialogDescription>
            {formatMx(event.start, "EEEE d 'de' MMMM, yyyy", { locale: es })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Horario: </span>
            <span className="font-medium">
              {formatMx(event.start, "HH:mm")} – {formatMx(event.end, "HH:mm")}
            </span>
          </div>
          {event.doctorName && (
            <div>
              <span className="text-muted-foreground">Doctor: </span>
              <span>{event.doctorName}</span>
            </div>
          )}
          {event.description && (
            <div>
              <span className="text-muted-foreground">Descripción: </span>
              <span>{event.description}</span>
            </div>
          )}
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir en {providerLabel} Calendar
            </a>
          )}
          <p className="text-xs text-muted-foreground italic">
            Este evento vive en el calendario externo del doctor. Solo el doctor
            puede editarlo o eliminarlo desde su agenda.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
