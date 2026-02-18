
## Corrección definitiva: zona horaria y nombre del paciente

### Diagnóstico confirmado

#### Bug 1 — Zona horaria (reservé a las 11:00, aparece 5:00)

El archivo `supabase/functions/reserve-create/index.ts` en las líneas 94 y 99 construye los timestamps **sin offset de zona horaria**:

```
const startAt = `${date}T${slot_start}:00`;      // → "2026-02-18T11:00:00"
const endAt   = `${date}T${endHH}:${endMM}:00`;  // → "2026-02-18T11:30:00"
```

PostgreSQL almacena columnas `timestamp with time zone`. Al recibir un string sin offset, asume **UTC**, guardando `2026-02-18T11:00:00+00`. El navegador del doctor en México (UTC-6) convierte eso a las **5:00 AM local**. Esto ocurre porque el fix planeado en la conversación anterior nunca se aplicó.

**Fix**: Agregar el offset `-06:00` explícito:
```
const startAt = `${date}T${slot_start}:00-06:00`;
const endAt   = `${date}T${endHH}:${endMM}:00-06:00`;
```

Esto hace que PostgreSQL almacene `2026-02-18T17:00:00+00` (11:00 CDMX = 17:00 UTC), y el navegador lo convierte correctamente a 11:00 AM local.

**También aplica a `manage-reschedule`**: El mismo bug existe en la función de reagendamiento.

#### Bug 2 — "Paciente desconocido"

La consulta de la base de datos confirma que la tabla `patients` tiene **únicamente 2 políticas**:
- `Admin can manage patients` (ALL)
- `Admin can read patients` (SELECT)

No existe ninguna política para doctores. La migración que se planeó anteriormente tampoco se ejecutó.

Cuando `Agenda.tsx` ejecuta:
```typescript
.select("id, google_event_id, start_at, end_at, ..., patients(full_name, phone)")
```

Supabase evalúa RLS en el contexto del usuario doctor. Como el doctor no tiene permiso de SELECT en `patients`, el join devuelve `null` → se muestra `"Paciente desconocido"`.

**Fix**: Agregar una política RLS que permita al doctor leer los pacientes de sus propias citas:
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

---

### Cambios a implementar

| Archivo / Recurso | Cambio |
|---|---|
| `supabase/functions/reserve-create/index.ts` | Líneas 94 y 99: agregar `-06:00` a `startAt` y `endAt` |
| `supabase/functions/manage-reschedule/index.ts` | Mismo fix de offset en los timestamps |
| Migración SQL | Nueva policy RLS en `patients` para doctores |

### Nota sobre las citas existentes

Las citas ya creadas con horario incorrecto seguirán mostrando mal en la agenda porque sus timestamps ya están guardados en UTC sin el offset correcto. Solo las **nuevas citas** creadas después de este fix se guardarán correctamente. Las antiguas tendrían que corregirse manualmente en la BD si es necesario.
