
## Correcciones: 4 bugs identificados

### Problema 1 — Doctor cancela: evento de Google Calendar no se elimina

El archivo `cancel-by-doctor/index.ts` no tiene la lógica de eliminar el evento de Google Calendar. Solo cancela en la base de datos.

**Fix**: Agregar al select de appointments el campo `google_event_id`, y después de cancelar, replicar la misma lógica que ya existe en `manage-cancel/index.ts`:

```
// Get doctor Google credentials
const doctor = await supabase.from("doctors")
  .select("google_refresh_token_ref, google_calendar_id, google_calendar_connected")
  .eq("id", doctorId).maybeSingle();

if (appointment.google_event_id && doctor.google_calendar_connected && ...) {
  // Refresh token
  // DELETE https://www.googleapis.com/calendar/v3/calendars/{calId}/events/{eventId}
}
```

---

### Problema 2 — Link de reagendamiento no muestra opción de reagendar

En `Gestionar.tsx`, el bloque de botones (confirmar, reagendar, cancelar) está envuelto en:

```tsx
{!cancelled && appointment.status !== "cancelled" && (
  <div className="space-y-2 pt-2"> ...botones... </div>
)}
```

Y la sección del calendario de reagendamiento también está bloqueada por `!cancelled`:

```tsx
{showReschedule && !cancelled && ( ...calendario... )}
```

Cuando el doctor cancela la cita y envía el link de reagendamiento, el paciente llega con `status === "cancelled"` y no ve ningún botón.

**Fix**: Separar la lógica. Mostrar el botón de reagendar y el calendario incluso cuando `status === "cancelled"` o `cancelled === true`. Solo ocultar confirmar y cancelar cuando ya está cancelada.

Nueva lógica:
```tsx
{/* Confirmar y Cancelar — solo si NO está cancelada */}
{!cancelled && appointment.status !== "cancelled" && (
  <>
    {/* Confirmar */}
    {/* Cancelar */}
  </>
)}

{/* Reagendar — siempre visible (incluso si está cancelada) */}
<Button onClick={() => setShowReschedule(!showReschedule)}>
  Reagendar cita
</Button>

{/* Calendario de reagendamiento */}
{showReschedule && ( ...calendario... )}
```

Además agregar un mensaje contextual cuando `status === "cancelled"`:
```tsx
{(cancelled || appointment.status === "cancelled") && (
  <p className="text-sm text-muted-foreground">
    Tu cita fue cancelada. Puedes reagendar a continuación.
  </p>
)}
```

---

### Problema 3 — Citas duplicadas al agendar

**Root cause identificado**: En `reserve-slots/index.ts`, el query de citas existentes usa:

```typescript
.gte("start_at", dayStart)   // "2026-02-19T00:00:00" (sin zona)
.lte("start_at", dayEnd)     // "2026-02-19T23:59:59" (sin zona)
```

Las citas en la base de datos se almacenan en UTC. Por ejemplo, una cita a las 10:00am Ciudad de México (-06:00) se guarda como `2026-02-19T16:00:00+00:00`. Cuando el query compara `start_at` (en UTC) contra las strings `2026-02-19T00:00:00` sin zona, PostgreSQL las interpreta como UTC y la comparación es correcta a nivel de fecha.

**Sin embargo el problema real es en `apptStart.getHours()`**: al hacer `new Date(appt.start_at)`, el resultado en el servidor Deno queda en UTC. `apptStart.getHours()` devuelve la hora UTC (16h) en lugar de la hora local de México (10h). Entonces el slot de 10:00-11:00 NO se detecta como ocupado porque se compara con 16:00-17:00 UTC.

**Fix en `reserve-slots/index.ts`**: Parsear los `start_at`/`end_at` de las citas existentes igual que se parsean los eventos de Google Calendar — extrayendo la parte de tiempo del string ISO directamente:

```typescript
// En lugar de:
const apptStart = new Date(appt.start_at);
const apptStartMin = apptStart.getHours() * 60 + apptStart.getMinutes();

// Usar:
const parseLocalMinutes = (dtStr: string): number => {
  // dtStr example: "2026-02-19T16:00:00+00:00" (UTC stored)
  // Need to convert to Mexico City offset (-06:00): 16 - 6 = 10h
  const d = new Date(dtStr);
  // Use Intl to get Mexico City local time
  const formatter = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const h = parseInt(parts.find(p => p.type === "hour")!.value);
  const m = parseInt(parts.find(p => p.type === "minute")!.value);
  return h * 60 + m;
};
```

---

### Problema 4 — Editar payload de webhooks

Actualmente `PAYLOAD_EXAMPLES` es un objeto estático en el código. No es editable desde la UI.

**Solución**: Agregar una columna `payload_overrides` (tipo `jsonb`) a la tabla `webhooks`. Por defecto `null` (usa los ejemplos estáticos del código). Cuando el admin edita el JSON de un evento en el dialog, se guarda en esa columna.

**En la UI** (`Webhooks.tsx`), dentro del Tab "Payload de ejemplo":
- Cada `PayloadBlock` pasa de ser solo lectura a tener un botón de editar
- Al hacer click, el bloque `<pre>` se convierte en un `<Textarea>` editable con el JSON actual
- Botón "Guardar" llama a `supabase.from("webhooks").update({ payload_overrides: {...} })` solo para ese evento
- Validación: que el JSON sea válido antes de guardar

**Estado local en el componente**:
```typescript
const [editingPayload, setEditingPayload] = useState<string | null>(null); // eventId siendo editado
const [payloadDraft, setPayloadDraft] = useState<Record<string, string>>({}); // eventId -> JSON string
```

El `PAYLOAD_EXAMPLES` sigue siendo el fallback cuando no hay override guardado.

**Migración SQL**: Agregar columna `payload_overrides jsonb` a `webhooks`:
```sql
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS payload_overrides jsonb DEFAULT NULL;
```

---

### Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/cancel-by-doctor/index.ts` | Agregar `google_event_id` al select + lógica de borrado de evento en Google Calendar |
| `src/pages/patient/Gestionar.tsx` | Mostrar botón reagendar y calendario incluso cuando status=cancelled; agregar mensaje explicativo |
| `supabase/functions/reserve-slots/index.ts` | Usar `Intl.DateTimeFormat` para convertir UTC→Mexico City al comparar slots con citas existentes |
| `src/pages/admin/Webhooks.tsx` | Hacer los payload examples editables por evento; leer/escribir `payload_overrides` de la DB |
| Migración SQL | `ALTER TABLE webhooks ADD COLUMN payload_overrides jsonb` |
