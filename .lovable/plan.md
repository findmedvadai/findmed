

## Editar, eliminar y arrastrar eventos de Google Calendar desde la agenda

### Resumen

Actualmente, al hacer clic en un evento de Google Calendar en la agenda, solo se muestra un enlace para abrirlo en Google. No hay forma de editarlo, eliminarlo ni arrastrarlo a otro horario. Este plan agrega esas 3 funcionalidades para que la agenda funcione como un espejo completo de Google Calendar.

---

### 1. Dos nuevas backend functions

**`google-calendar-update-event`** - Actualiza un evento existente en Google Calendar (PATCH).

- Recibe: `event_id`, `summary` (opcional), `description` (opcional), `start_at`, `end_at`
- Usa el mismo patron de autenticacion JWT + refresh token
- Llama a `PATCH /calendars/{calendarId}/events/{eventId}`

**`google-calendar-delete-event`** - Elimina un evento de Google Calendar.

- Recibe: `event_id`
- Llama a `DELETE /calendars/{calendarId}/events/{eventId}`

Ambas se registran en `supabase/config.toml` con `verify_jwt = false`.

---

### 2. Editar y eliminar desde el dialog de detalle

**Modificar `AppointmentDetailDialog.tsx`** para que cuando el evento sea de tipo `google`:

- Muestre botones "Editar" y "Eliminar" (en vez de solo el link)
- "Editar" abre un formulario inline (o reutiliza el CreateEventDialog en modo edicion) con titulo, descripcion, fecha, hora inicio, hora fin pre-llenados
- "Eliminar" muestra un AlertDialog de confirmacion y llama a `google-calendar-delete-event`
- Al guardar/eliminar, invalida las queries de Google Calendar para refrescar la agenda

**Alternativa mas limpia**: Convertir `CreateEventDialog` en `EventDialog` que soporte modo "crear" y modo "editar". En modo editar recibe el `event_id` y los datos actuales, y usa la funcion de update en vez de create.

---

### 3. Drag-and-drop para cambiar horario

**Modificar `Agenda.tsx`** para agregar arrastre vertical (y opcionalmente horizontal entre dias):

- Solo eventos de tipo `google` son arrastrables (las citas de la plataforma no se pueden mover manualmente segun las reglas de negocio)
- Al iniciar drag: guardar el item y la posicion Y inicial
- Durante drag: actualizar visualmente la posicion del evento (CSS transform)
- Al soltar: calcular la nueva hora basandose en la posicion Y final y el dia (columna) donde se solto
- Llamar a `google-calendar-update-event` con las nuevas fechas/horas
- Mostrar toast de exito/error y refrescar la agenda

**Implementacion tecnica del drag:**
- Usar `onMouseDown` / `onMouseMove` / `onMouseUp` nativo (no necesita libreria externa)
- Mantener estado `draggingItem` y `dragOffset` en el componente
- Renderizar un "ghost" del evento durante el arrastre
- Snap a intervalos de 15 o 30 minutos al soltar

---

### Resumen de archivos

| Archivo | Accion |
|---|---|
| `supabase/functions/google-calendar-update-event/index.ts` | Crear |
| `supabase/functions/google-calendar-delete-event/index.ts` | Crear |
| `src/components/doctor/CreateEventDialog.tsx` | Modificar (soportar modo editar con event_id) |
| `src/components/doctor/AppointmentDetailDialog.tsx` | Modificar (botones editar/eliminar para eventos Google) |
| `src/pages/doctor/Agenda.tsx` | Modificar (drag-and-drop para eventos Google) |

### Notas tecnicas

- El drag-and-drop se implementa con eventos nativos del mouse, sin dependencias adicionales
- Solo los eventos de tipo "google" son editables/arrastrables; las citas de la plataforma siguen las reglas actuales (el doctor no puede mover citas manualmente)
- Para el campo `description` en edicion, se necesita que `google-calendar-events` retorne tambien `description` (ya lo hace)
- El snap al arrastrar sera de 15 minutos para precision, consistente con Google Calendar

