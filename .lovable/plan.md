

## Cambiar expiración de manage tokens: de 12 horas fijas a cuando pase la cita

### Que cambia

Actualmente los tokens de gestión (manage tokens) expiran 12 horas después de crearse. Con este cambio, expirarán cuando la cita termine (`end_at` de la cita), para que el paciente pueda gestionar su cita en cualquier momento antes de que ocurra.

### Comportamiento nuevo

- Si agendo una cita para dentro de 2 semanas, el link funciona durante esas 2 semanas
- Si agendo una cita para dentro de 3 días, el link funciona esos 3 días
- Una vez que pasa la hora de la cita, el link expira automáticamente

### Archivos a modificar

**1. `supabase/functions/reserve-create/index.ts`**
- Cambiar `expires_at` de `Date.now() + 12h` a usar el valor de `endAt` (fin de la cita)

**2. `supabase/functions/generate-manage-link/index.ts`**
- Obtener `start_at` y `end_at` de la cita en el query inicial
- Usar `end_at` como `expires_at` del token

**3. `supabase/functions/cancel-by-doctor/index.ts`**
- Obtener `end_at` de la cita (ya disponible en el query)
- Usar `end_at` como `expires_at` del token de reagendamiento

**4. `supabase/functions/send-appointment-reminders/index.ts`**
- Cuando genera un token nuevo (línea 85), usar `end_at` de la cita en lugar de `now + 72h`

**5. `supabase/functions/send-day-of-reminders/index.ts`**
- Misma lógica: usar `end_at` de la cita como expiración del token

### Detalle técnico

En cada función, el cambio es mínimo. Ejemplo en `reserve-create`:

Antes:
```typescript
const manageExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
```

Después:
```typescript
const manageExpiresAt = endAt; // expira cuando termina la cita
```

Las validaciones de expiración en `manage-validate`, `manage-cancel`, `manage-reschedule` y `confirm-appointment` no necesitan cambios porque ya comparan `expires_at < now()`, lo cual seguirá funcionando correctamente con la nueva fecha.

