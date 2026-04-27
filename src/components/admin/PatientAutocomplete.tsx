import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface PatientLookupResult {
  id: string;
  full_name: string;
  phone: string;
}

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (patient: PatientLookupResult) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Debounced search against the `admin-search-patients` Edge Function. Renders
 * a small dropdown of matches while the input is focused. The parent owns the
 * input value (so it can be cleared programmatically after selection).
 */
export default function PatientAutocomplete({
  query,
  onQueryChange,
  onSelect,
  placeholder = "Buscar paciente por nombre o teléfono...",
  className,
}: Props) {
  const [results, setResults] = useState<PatientLookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/admin-search-patients`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: trimmed, limit: 8 }),
        });
        const data = await res.json();
        setResults((data?.patients ?? []) as PatientLookupResult[]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && (
          <Loader2 className="absolute right-2 top-2 h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {!loading && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <UserPlus className="h-4 w-4" />
              Sin coincidencias. Continúa escribiendo y creará un paciente nuevo al guardar.
            </div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-medium">{p.full_name}</span>
              <span className="text-xs text-muted-foreground">{p.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
