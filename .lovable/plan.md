
## Corrección de dos bugs en el flujo de agendamiento

### Diagnóstico

#### Bug 1: Hora incorrecta (se eligió 14:00 pero aparece 08:00)

**Causa raíz — inconsistencia de zona horaria:**

La función `reserve-create` guarda la cita como:
```
startAt = "2026-02-18T14:00:00"  // sin zona horaria
```

Al insertar en PostgreSQL (columna `timestamp with time zone`), el servidor Supabase corre en UTC, por lo que interpreta ese string como **14:00 UTC** y lo almacena como `2026-02-18 14:00:00+00`.

Al leerlo en el navegador del médico en México (UTC-6):
- `new Date("2026-02-18 14:00:00+00")` → convierte a local → **08:00 AM**
- `format(parseISO(...), "HH:mm")` → muestra **08:00**

El paciente ve 14:00 en la pantalla de confirmación porque lee el string crudo del response de la función (sin `+00`), que el navegador interpreta como hora local.

**La solución:** Agregar el offset de México Ciudad (`-06:00`) al guardar, de modo que `"2026-02-18T14:00:00-06:00"` se almacene como `2026-02-18 20:00:00+00` en la DB y cuando el navegador lo lea, lo convierta de UTC+0 → México UTC-6 → **14:00 local**, que es lo correcto.

#### Bug 2: "Paciente desconocido"

**Causa raíz — el join con `patients` no devuelve datos:**

En `Agenda.tsx`, la query hace:
```typescript
.select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
```

Este join funciona si existe una foreign key de `appointments.patient_id → patients.id`. Sin embargo, al leer la DB directamente sí se ve el nombre correcto. El problema es que la RLS de la tabla `patients` solo permite acceso a admins:

```
Policy: "Admin can manage patients" — Command: ALL — USING: is_admin_or_superadmin(auth.uid())
Policy: "Admin can read patients"   — Command: SELECT — USING: is_admin_or_superadmin(auth.uid())
```

**El doctor NO tiene permiso de SELECT en la tabla `patients`.** Por lo tanto, cuando Supabase ejecuta el join embebido, los datos de `patients` retornan `null` para usuarios con rol `doctor`. El resultado es que `patient?.full_name` es `null` → se muestra `"Paciente desconocido"`.

**La solución:** Agregar una política RLS que permita al doctor leer los pacientes asociados a sus propias citas.

---

### Plan de implementación

#### Cambio 1: Fix de zona horaria en `reserve-create`

Modificar la función `supabase/functions/reserve-create/index.ts` para que al construir `startAt` y `endAt` se incluya el offset de México City (`-06:00`):

```
// Antes:
const startAt = `${date}T${slot_start}:00`;
const endAt   = `${date}T${endHH}:${endMM}:00`;

// Después:
const startAt = `${date}T${slot_start}:00-06:00`;
const endAt   = `${date}T${endHH}:${endMM}:00-06:00`;
```

Esto garantiza que PostgreSQL almacene la hora correcta y que el navegador la muestre igual en cualquier zona horaria.

También hay que aplicar el mismo fix en `supabase/functions/manage-reschedule/index.ts` para que reagendar tampoco tenga este problema.

#### Cambio 2: Política RLS para que el doctor pueda leer sus pacientes

Agregar una migration con la siguiente policy en la tabla `patients`:

```sql
CREATE POLICY "Doctor can read own patients"
  ON public.patients
  FOR SELECT
  USING (
    id IN (
      SELECT patient_id FROM public.appointments
      WHERE doctor_id = get_doctor_id_for_user(auth.uid())
    )
  );
```

Esto permite al doctor leer únicamente los pacientes que tienen citas con él, sin exponer otros pacientes del sistema.

---

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/reserve-create/index.ts` | Agregar offset `-06:00` a `startAt` y `endAt` |
| `supabase/functions/manage-reschedule/index.ts` | Agregar offset `-06:00` a `startAt` y `endAt` |
| Migration SQL | Nueva policy RLS en `patients` para doctores |

---

### Notas técnicas

- El offset `-06:00` corresponde a **America/Mexico_City** en horario estándar. En horario de verano (CST → CDT) el offset cambia a `-05:00`. Si se necesita precisión total, se puede usar la librería de Temporal/Intl para obtener el offset real en la fecha dada, pero para esta aplicación el offset fijo es suficiente por ahora.
- El join embebido de Supabase (`patients(full_name, phone)`) evalúa RLS en el contexto del usuario autenticado, por eso el doctor no ve los datos a pesar de que la cita sí le pertenece.
