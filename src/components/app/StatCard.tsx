import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  /** Si viene, toda la tarjeta lleva a esa ruta. */
  to?: string;
  className?: string;
}

/** Indicador compacto (número + etiqueta) para tableros. */
export function StatCard({ label, value, hint, icon: Icon, tone = "neutral", to, className }: StatCardProps) {
  const body = (
    <div className={cn("flex items-start gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors", to && "hover:border-primary/30 hover:bg-accent/40", className)}>
      {Icon && (
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", TONE_ICON[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold leading-tight tracking-tight text-foreground">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}
