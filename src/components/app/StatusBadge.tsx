import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "./StatCard";
import { APPOINTMENT_STATUS } from "@/lib/appointment-status";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-info/20 bg-info/10 text-info",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
};

/** Etiqueta suave de estado (fondo tenue + texto del tono). Usar en vez de colores sueltos. */
export function SoftBadge({ tone = "neutral", children, className, dot = false }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE_CLASS[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Estado de una cita con el mismo color en todos los módulos. */
export function AppointmentStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = APPOINTMENT_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <SoftBadge tone={s.tone} dot className={className}>{s.label}</SoftBadge>;
}
