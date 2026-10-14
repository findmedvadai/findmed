// "Nuevo caso" (Etapa 2): el equipo abre un caso a mano — p. ej. un reembolso
// que el paciente pidió por teléfono. Lo mínimo: paciente, tipo, prioridad y
// resumen. Se escribe vía case-actions (create_case); si el paciente ya tiene
// un caso activo del mismo tipo, el resumen se agrega a ese caso.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Phone, UserRound, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PatientAutocomplete, { type PatientLookupResult } from "@/components/admin/PatientAutocomplete";
import { toast } from "@/hooks/use-toast";
import { extractEdgeFunctionError, toastFromEdgeFunctionError } from "@/lib/edge-function-error";
import { CASE_PRIORITY, CASE_TYPE_LABEL } from "@/lib/case-labels";
import { createCase, type PatientCase } from "@/lib/case-actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (c: PatientCase) => void;
}

const digits = (v: string) => v.replace(/\D/g, "");

export default function NewCaseDialog({ open, onOpenChange, onCreated }: Props) {
  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<PatientLookupResult | null>(null);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [requestType, setRequestType] = useState("");
  const [priority, setPriority] = useState("normal");
  const [summary, setSummary] = useState("");

  const reset = () => {
    setQuery("");
    setPatient(null);
    setContactName("");
    setPhone("");
    setRequestType("");
    setPriority("normal");
    setSummary("");
  };

  const hasContact = !!patient || digits(phone).length >= 10;
  const canSubmit = hasContact && !!requestType && summary.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () =>
      createCase({
        request_type: requestType,
        priority,
        summary: summary.trim(),
        ...(patient ? { patient_id: patient.id } : { phone: phone.trim(), contact_name: contactName.trim() || undefined }),
      }),
    onSuccess: (res) => {
      if (res.warnings.length > 0) {
        toast({ title: "Caso existente actualizado", description: res.warnings.join(" ") });
      } else {
        toast({ title: "Caso creado" });
      }
      onCreated(res.case);
      reset();
      onOpenChange(false);
    },
    onError: async (err) => {
      const parsed = await extractEdgeFunctionError(err);
      const { title, description } = toastFromEdgeFunctionError(parsed, "No se pudo crear el caso");
      toast({ title, description, variant: "destructive" });
    },
  });

  const handleOpenChange = (o: boolean) => {
    if (!o && mutation.isPending) return;
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo caso</DialogTitle>
          <DialogDescription>Registra una solicitud que el equipo debe atender, por ejemplo un reembolso.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Paciente</Label>
            {patient ? (
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{patient.full_name}</p>
                  <p className="text-xs text-muted-foreground">{patient.phone}</p>
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-muted-foreground" onClick={() => setPatient(null)}>
                  <X className="h-3.5 w-3.5" /> Cambiar
                </Button>
              </div>
            ) : (
              <>
                <PatientAutocomplete
                  query={query}
                  onQueryChange={setQuery}
                  onSelect={(p) => {
                    setPatient(p);
                    setQuery("");
                  }}
                  emptyText="Sin coincidencias. Si no está registrado, escribe su teléfono abajo."
                />
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="new-case-name" className="text-xs text-muted-foreground">Nombre (si no está registrado)</Label>
                    <Input id="new-case-name" className="h-9 text-sm" value={contactName} maxLength={120} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-case-phone" className="text-xs text-muted-foreground">Teléfono (10 dígitos)</Label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="new-case-phone"
                        type="tel"
                        inputMode="tel"
                        className="h-9 pl-8 text-sm"
                        value={phone}
                        maxLength={20}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-case-type" className="text-sm font-medium">Tipo</Label>
              <Select value={requestType} onValueChange={setRequestType}>
                <SelectTrigger id="new-case-type" className="h-9 text-sm">
                  <SelectValue placeholder="Elige el tipo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CASE_TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-case-priority" className="text-sm font-medium">Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="new-case-priority" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CASE_PRIORITY).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-case-summary" className="text-sm font-medium">Resumen</Label>
            <Textarea
              id="new-case-summary"
              rows={3}
              className="resize-none text-sm"
              value={summary}
              maxLength={1000}
              placeholder="Qué necesita el paciente. Ej. Reembolso de consulta con AXA, entregó factura por correo."
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? "Creando…" : "Crear caso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
