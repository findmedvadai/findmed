
## Corrección de 3 problemas: duplicados en agenda, indicadores de notificación y re-autenticación de contraseña

---

### Problema 1: Eventos duplicados en la agenda del doctor

**Causa raíz:**

Cuando se agenda una cita, `reserve-create` crea:
1. Un registro en la tabla `appointments` (evento interno, amarillo en la agenda)
2. Un evento en Google Calendar con el mismo contenido (evento externo, azul en la agenda)

La función `google-calendar-events` devuelve todos los eventos del calendario de Google, incluyendo el que fue creado automáticamente por la plataforma.

En `Agenda.tsx`, la deduplicación actual intenta evitar esto:
```typescript
const appointmentIds = new Set((appointments || []).map((a) => a.id));
for (const e of googleEvents || []) {
  if (appointmentIds.has(e.id)) continue; // filtra por google_event_id == appointment.id
```

Pero el problema es que compara `e.id` (el ID del evento en Google Calendar) con `a.id` (el UUID de la cita en la plataforma). Estos nunca son iguales, por lo que el filtro no funciona. La cita siempre aparece duplicada.

**La solución:**

La tabla `appointments` ya tiene una columna `google_event_id` que se llena cuando se crea el evento en Google Calendar. Se debe usar ese campo para la deduplicación en `Agenda.tsx`:

```typescript
// Antes (no funciona):
const appointmentIds = new Set((appointments || []).map((a) => a.id));

// Después (correcto):
const googleEventIds = new Set(
  (appointments || []).map((a) => a.google_event_id).filter(Boolean)
);
for (const e of googleEvents || []) {
  if (googleEventIds.has(e.id)) continue; // filtra correctamente
```

Esto requiere que la query de `appointments` también seleccione `google_event_id`.

**Sobre el timezone de los eventos de Google:**

Los eventos de Google Calendar ya vienen con el offset correcto en su campo `dateTime` (ej. `2026-02-18T14:00:00-06:00`). La función `google-calendar-events` los pasa tal cual. `parseISO` los interpreta correctamente. El problema de que aparecen en horario incorrecto era porque ambos eventos (azul y amarillo) se mostraban y el amarillo tenía el bug de zona horaria que ya se planeó corregir con el offset `-06:00`.

Al eliminar los duplicados y mantener la regla de timezone, la agenda mostrará un solo evento por cita en el horario correcto.

---

### Problema 2: Indicador de notificaciones no leídas (círculo rojo)

**Diseño:**

Crear un hook `useUnreadNotifications` que retorne los conteos de no leídas para doctor y admin. Este hook consulta la tabla `notifications` y se mantiene actualizado mediante Realtime (ya existe la suscripción).

- **Doctor:** contar `notifications` donde `doctor_id = doctorId AND recipient_role = 'doctor' AND is_read = false`
- **Admin:** contar `notifications` donde `recipient_role IN ('admin', 'superadmin') AND is_read = false`

**Implementación:**

En `DoctorLayout.tsx`: añadir una query de conteo de no leídas y mostrar un punto rojo sobre el ícono del item "Inbox".

En `AdminLayout.tsx`: igual, pero para el admin.

El badge debe desaparecer automáticamente cuando las notificaciones se marcan como leídas (ya que tanto DoctorInbox como AdminInbox marcan como leídas al interactuar, y el Realtime actualiza el conteo).

El círculo rojo aparecerá como un pequeño punto superpuesto al nombre del nav item:

```tsx
<span>{item.title}</span>
{item.url === "/doctor/inbox" && unreadCount > 0 && (
  <span className="ml-auto h-2 w-2 rounded-full bg-red-500" />
)}
```

---

### Problema 3: Re-autenticación de contraseña al hacer login

**Causa raíz actual:**

`PasswordGate` guarda el estado en `sessionStorage`. El `sessionStorage` persiste durante toda la sesión del navegador (no se borra al cerrar sesión con `signOut`). Entonces si el admin cierra sesión y vuelve a entrar sin cerrar la pestaña, la contraseña ya está "recuerdada".

**La solución:**

En lugar de usar `sessionStorage`, vincular el estado de "desbloqueado" al ID de sesión de autenticación actual. Al hacer login, el ID de sesión cambia, por lo que el unlock anterior ya no es válido.

Estrategia: guardar en `sessionStorage` tanto el flag como el `session.id` (o `user.id`) del momento en que se desbloqueó. Al leer el storage, validar que el `session.id` actual coincida con el guardado.

```typescript
// Al desbloquear:
sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ unlocked: true, sessionId: session.id }));

// Al inicializar:
const stored = sessionStorage.getItem(STORAGE_KEY);
const { unlocked, sessionId } = JSON.parse(stored);
if (unlocked && sessionId === currentSession.id) setUnlocked(true);
```

Esto garantiza que al hacer un nuevo login (nueva sesión, nuevo `session.id`), el gate vuelve a pedir contraseña aunque la pestaña del navegador no se haya cerrado.

`PasswordGate` necesita recibir el `session` actual como prop o leerlo a través del hook `useAuth`.

---

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/doctor/Agenda.tsx` | Fix de deduplicación: usar `google_event_id` en lugar de `id` para filtrar eventos de Google Calendar |
| `src/components/layouts/DoctorLayout.tsx` | Añadir query de notificaciones no leídas y mostrar indicador rojo en el nav item de Inbox |
| `src/components/layouts/AdminLayout.tsx` | Añadir query de notificaciones no leídas y mostrar indicador rojo en el nav item de Inbox |
| `src/components/admin/PasswordGate.tsx` | Vincular el estado de desbloqueado al `session.id` actual para forzar re-autenticación en cada nuevo login |

---

### Notas técnicas

- La query de appointments en Agenda ya selecciona los campos necesarios excepto `google_event_id` — se agrega al `.select()`.
- El Realtime de notificaciones ya existe en `DoctorInbox` y `AdminInbox`. En los layouts se hará una query ligera (`count`) que se invalida por Realtime para mantener el badge actualizado sin lógica duplicada costosa.
- No se requieren cambios en la base de datos ni en Edge Functions para ninguno de estos tres cambios.
