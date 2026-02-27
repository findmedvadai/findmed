

## Plan: 5 modificaciones

### 1. Barra de busqueda en el Inbox del Admin

**Archivo**: `src/pages/admin/Inbox.tsx`

- Agregar un Input de busqueda arriba de los filtros de doctor/especialidad
- Estado `searchQuery` (string)
- Filtrar las notificaciones en el cliente buscando en `title`, `body` y `doctors.full_name`
- La busqueda sera case-insensitive y buscara coincidencias parciales

---

### 2. Quitar boton de confirmar en la pagina de Gestionar (solo cancelar y reagendar)

**Archivo**: `src/pages/patient/Gestionar.tsx`

- Eliminar el boton "Confirmar cita" y toda la logica asociada (`handleConfirm`, estados `confirming`, `confirmed`)
- La confirmacion solo se hara desde el link de 48 horas (que llama a `confirm-appointment` directamente desde n8n/WhatsApp)
- El paciente solo vera: Cancelar cita + Reagendar cita

---

### 3. Endpoints para confirmar/cancelar cita desde n8n (via API Key)

Los endpoints `confirm-appointment` y `manage-cancel` ya existen pero necesitan poder recibir llamadas desde n8n usando API Key (actualmente `confirm-appointment` acepta `appointment_id` o `patient_phone`, y `manage-cancel` requiere manage token).

Se creara un nuevo endpoint unificado: `update-appointment-status`

**Archivo nuevo**: `supabase/functions/update-appointment-status/index.ts`

- Autenticacion via API Key (mismo patron que `triage-webhook`: header `Authorization: Bearer fm_...`, validacion SHA-256 contra `api_keys`)
- Acepta: `{ appointment_id: string, action: "confirm" | "cancel" }` o `{ patient_phone: string, action: "confirm" | "cancel" }`
- Si `action = "confirm"`: cambia status de `scheduled` a `confirmed`, dispara webhooks `appointment.confirmed` + `appointment.status_changed`
- Si `action = "cancel"`: cambia status a `cancelled`, dispara webhooks `appointment.cancelled` + `appointment.status_changed`
- Retorna `{ success: true, appointment_id, new_status }`

Tambien se agrega `verify_jwt = false` en `config.toml`.

Uso desde n8n:
```
POST /functions/v1/update-appointment-status
Authorization: Bearer fm_tu_api_key
Content-Type: application/json

{ "appointment_id": "uuid-de-la-cita", "action": "confirm" }
```

o por telefono del paciente:
```
{ "patient_phone": "+521234567890", "action": "cancel" }
```

---

### 4. Lista de estados del webhook `appointment.status_changed`

Los estados que se envian en el campo `new_status` del webhook `appointment.status_changed` son:

| Valor del campo `new_status` | Significado |
|---|---|
| `scheduled` | Cita recien creada (reservada) |
| `confirmed` | Cita confirmada por el paciente |
| `cancelled` | Cita cancelada (por paciente, doctor o auto-cancelacion) |
| `completed` | Cita completada por el doctor |

Para el switch en n8n, puedes usar el campo `new_status` con estos 4 valores exactos. El campo `previous_status` tambien viene en el payload para saber desde que estado cambio.

**No requiere cambios de codigo**, solo es informacion para tu configuracion de n8n.

---

### 5. Mejorar popup de Google Calendar callback

**Archivo**: `supabase/functions/google-calendar-callback/index.ts`

Actualmente el HTML de exito dice "Tu cuenta de Google ha sido vinculada. Cierra esta ventana..." con un boton generico. Se mejorara para:

- Mostrar un icono de check verde (SVG inline)
- Titulo claro: "Conexion exitosa"
- Mensaje: "Tu cuenta de Google ha sido vinculada correctamente. Ya puedes cerrar esta ventana."
- El boton dira "Cerrar ventana"
- Agregar `window.opener?.postMessage("google-calendar-connected", "*")` para que la ventana padre pueda detectar la conexion y refrescar automaticamente
- Auto-cerrar la ventana despues de 3 segundos con `setTimeout(() => window.close(), 3000)` y un mensaje de "Esta ventana se cerrara automaticamente..."

### Detalle tecnico

**update-appointment-status** -- Endpoint nuevo:
- Copia el patron de autenticacion de `triage-webhook` (API Key via Bearer token + SHA-256 hash)
- Busca cita por `appointment_id` o por `patient_phone` (la mas proxima con status `scheduled` o `confirmed`)
- Valida que la accion sea coherente (no confirmar una cita ya confirmada, no cancelar una ya cancelada)
- Dispara los webhooks correspondientes via `dispatch-webhook`
- Incluye notificacion en la tabla `notifications` para doctor y admin

**config.toml** -- Agregar:
```toml
[functions.update-appointment-status]
verify_jwt = false
```

