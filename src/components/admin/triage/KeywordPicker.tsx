// Selector múltiple restringido al vocabulario del motor de triaje, agrupado
// por categoría. El motor solo entiende estos términos: no se puede escribir
// uno libre. Los términos de "peso medio" (dolor, inflamación…) ayudan pero
// nunca deciden solos.
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, keywordLabel, type KeywordCategory, type TriageVocabulary } from "@/lib/triage-admin";

interface KeywordPickerProps {
  vocabulary: TriageVocabulary | undefined;
  value: string[];
  onChange: (next: string[]) => void;
  /** Texto del botón para abrir la lista. */
  addLabel?: string;
  emptyText?: string;
  id?: string;
  invalid?: boolean;
}

export function KeywordPicker({ vocabulary, value, onChange, addLabel = "Agregar términos", emptyText = "Sin términos.", id, invalid }: KeywordPickerProps) {
  const [open, setOpen] = useState(false);
  const half = new Set(vocabulary?.half_weight ?? []);
  const known = new Set(Object.values(vocabulary?.keywords ?? {}).flat());
  const selected = new Set(value);
  const toggle = (k: string) => onChange(selected.has(k) ? value.filter((v) => v !== k) : [...value, k]);

  return (
    <div className="space-y-2">
      <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5", invalid && "border-destructive")}>
        {value.length === 0 && <span className="px-1 text-sm text-muted-foreground">{emptyText}</span>}
        {value.map((k) => {
          const unknown = vocabulary && !known.has(k);
          return (
            <span
              key={k}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs text-foreground",
                unknown && "border-destructive/40 bg-destructive/10 text-destructive",
              )}
              title={unknown ? "Este término no está en el vocabulario del motor" : k}
            >
              {keywordLabel(k)}
              {half.has(k) && <span className="text-[10px] text-muted-foreground">½</span>}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => toggle(k)}
                aria-label={`Quitar ${keywordLabel(k)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {/* modal: permite desplazar la lista dentro del panel lateral */}
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button id={id} type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={!vocabulary}>
              <Plus className="h-3.5 w-3.5" /> {addLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar término…" className="h-9" />
              <CommandList className="max-h-72">
                <CommandEmpty>No hay términos con ese nombre. El motor solo entiende los del catálogo.</CommandEmpty>
                {vocabulary &&
                  (Object.keys(CATEGORY_LABEL) as KeywordCategory[]).map((cat) => (
                    <CommandGroup key={cat} heading={CATEGORY_LABEL[cat]}>
                      {(vocabulary.keywords[cat] ?? []).map((k) => (
                        <CommandItem key={k} value={`${k} ${keywordLabel(k)}`} onSelect={() => toggle(k)}>
                          <Check className={cn("mr-2 h-3.5 w-3.5", selected.has(k) ? "opacity-100" : "opacity-0")} />
                          <span className="flex-1">{keywordLabel(k)}</span>
                          {half.has(k) && <span className="text-[10px] text-muted-foreground">peso medio</span>}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
