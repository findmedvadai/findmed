// Datos del contacto (garantía 20-oct-2026): titular del teléfono, teléfono y,
// en una cita, el nombre de quien se atiende (puede ser un familiar del
// titular). El admin los corrige con "Editar datos"; se guardan con la Edge
// Function admin-update-patient-insurance (action "contact"), que además
// actualiza el contacto en WHAAPY.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractEdgeFunctionError, userErrorMessage } from "@/lib/edge-function-error";
import { contactChanges, type ContactUpdateBody } from "@/lib/patient-name";

export interface PatientContactValue {
  /** Titular del teléfono (patients.full_name). */
  fullName: string | null | undefined;
  phone: string | null | undefined;
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

async function updatePatientContact(body: ContactUpdateBody) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("admin-update-patient-insurance", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    const parsed = await extractEdgeFunctionError(res.error);
    throw new Error(parsed.message && !/non-2xx/i.test(parsed.message) ? parsed.message : "No se pudieron guardar los datos.");
  }
  return res.data as { patient: { id: string; full_name: string; phone: string } };
}

function ContactEditor({
  patientId,
  initial,
  appointmentId,
  onDone,
  onCancel,
}: {
  patientId: string;
  initial: PatientContactValue & { attendedName?: string | null };
  appointmentId?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(initial.fullName ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [attendedName, setAttendedName] = useState(initial.attendedName ?? "");
  const changes = contactChanges(patientId, initial, { fullName, phone, attendedName }, appointmentId);
  const nameInvalid = clean(fullName).length < 2;
  const phoneInvalid = clean(phone).replace(/\D/g, "").length < 10;

  const mutation = useMutation({
    mutationFn: () => updatePatientContact(changes!),
    onSuccess: () => {
      toast.success("Datos actualizados");
      onDone();
    },
    onError: (err: Error) => toast.error(userErrorMessage(err, "No se pudo completar la acción.")),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (changes && !nameInvalid && !phoneInvalid) mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`titular-${patientId}`} className="text-xs">Nombre del titular</Label>
          <Input
            id={`titular-${patientId}`}
            value={fullName}
            maxLength={120}
            onChange={(e) => setFullName(e.target.value)}
            className="h-9 text-sm"
            aria-invalid={nameInvalid}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`phone-${patientId}`} className="text-xs">Teléfono</Label>
          <Input
            id={`phone-${patientId}`}
            value={phone}
            maxLength={20}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            className="h-9 text-sm"
            aria-invalid={phoneInvalid}
          />
        </div>
        {appointmentId && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`attended-${appointmentId}`} className="text-xs">Nombre de quien se atiende en esta cita</Label>
            <Input
              id={`attended-${appointmentId}`}
              value={attendedName}
              maxLength={120}
              onChange={(e) => setAttendedName(e.target.value)}
              placeholder="Vacío = el titular"
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Si agenda para un familiar con el mismo teléfono, escribe aquí su nombre; el titular no cambia.
            </p>
          </div>
        )}
      </div>
      {(nameInvalid || phoneInvalid) && (
        <p className="text-xs text-destructive">
          {nameInvalid ? "Escribe el nombre completo del titular." : "Escribe un teléfono de 10 dígitos o con lada internacional."}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={mutation.isPending}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!changes || nameInvalid || phoneInvalid || mutation.isPending} className="gap-1.5">
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

/**
 * Bloque "Datos del contacto" para el detalle de cita y el de caso (solo admin).
 * Con `appointment` muestra y permite editar quién se atiende en esa cita.
 * `onSaved` refresca las vistas que pintan el nombre.
 */
export function PatientContactSection({
  patientId,
  contact,
  appointment,
  onSaved,
}: {
  patientId: string | null | undefined;
  contact: PatientContactValue;
  appointment?: { id: string; patientName: string | null | undefined } | null;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const attended = clean(appointment?.patientName);
  const titular = clean(contact.fullName);
  const sameAsTitular = !attended || attended.toLowerCase() === titular.toLowerCase();

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <UserRound className="h-4 w-4 text-muted-foreground" /> Datos del contacto
        </h3>
        {patientId && !editing && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Editar datos
          </Button>
        )}
      </div>

      {editing && patientId ? (
        <ContactEditor
          patientId={patientId}
          initial={{ ...contact, attendedName: appointment ? (sameAsTitular ? "" : attended) : null }}
          appointmentId={appointment?.id ?? null}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onSaved?.();
          }}
        />
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-0.5">
            <dt className="text-xs text-muted-foreground">Titular del teléfono</dt>
            <dd className="truncate text-sm text-foreground">{titular || "—"}</dd>
          </div>
          <div className="min-w-0 space-y-0.5">
            <dt className="text-xs text-muted-foreground">Teléfono</dt>
            <dd className="text-sm text-foreground">{clean(contact.phone) || "—"}</dd>
          </div>
          {appointment && (
            <div className="min-w-0 space-y-0.5">
              <dt className="text-xs text-muted-foreground">Se atiende en esta cita</dt>
              <dd className="truncate text-sm text-foreground">{sameAsTitular ? "El titular" : attended}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
