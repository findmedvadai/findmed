// Simple time picker built on top of shadcn Select. Discrete grid of 15-min
// steps from `min` to `max` inclusive. Replaces the native `<input type="time">`,
// which looks dated and inconsistent with the rest of the design system.
//
// Usage:
//   <TimePicker value={"09:00"} onValueChange={setStart} />
//   <TimePicker value={"17:30"} onValueChange={setEnd} step={30} />
import * as React from "react";
import { Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  value: string; // "HH:mm"
  onValueChange: (v: string) => void;
  /** Step in minutes (default 15). */
  step?: number;
  /** Inclusive lower bound, default "06:00". */
  min?: string;
  /** Inclusive upper bound, default "22:00". */
  max?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Show clock icon on the left. */
  withIcon?: boolean;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function format(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimePicker({
  value,
  onValueChange,
  step = 15,
  min = "06:00",
  max = "22:00",
  disabled,
  className,
  placeholder = "Hora",
  withIcon = false,
}: Props) {
  const options = React.useMemo(() => {
    const start = toMinutes(min);
    const end = toMinutes(max);
    const out: string[] = [];
    for (let m = start; m <= end; m += step) out.push(format(m));
    // Make sure the current value is always in the list, even if it doesn't
    // align with the step grid (e.g. an old appointment at 09:07).
    if (value && !out.includes(value)) {
      out.push(value);
      out.sort((a, b) => toMinutes(a) - toMinutes(b));
    }
    return out;
  }, [min, max, step, value]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn(withIcon && "pl-2", className)}>
        {withIcon && <Clock className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
