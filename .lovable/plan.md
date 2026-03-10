

## Plan: Sistema Post-Consulta

### Resumen

Sistema completo que reemplaza el formulario actual de "Por Completar" con un formulario estructurado de post-consulta, agrega catálogos de Hospitales y Laboratorios, y extiende el Inbox del admin con estados y acciones de envío de informes.

---

### 1. Nuevas tablas en la base de datos

**Tabla `post_consultation_forms`** — almacena los formularios enviados por doctores:
- `id` (uuid, PK)
- `appointment_id` (uuid, FK → appointments)
- `doctor_id` (uuid)
- `observations` (text, nullable)
- `prescribed_medications` (text, nullable) — null si toggle desactivado
- `imaging_studies` (text, nullable)
- `lab_tests` (text, nullable)
- `specialist_referral` (text, nullable)
- `hospitalization` (text, nullable)
- `review_status` (enum: 'pending', 'read', 'report_sent') default 'pending'
- `report_destination_type` (text, nullable) — 'hospital' o 'laboratory'
- `report_destination_id` (uuid, nullable)
- `report_sent_at` (timestamptz, nullable)
- `created_at` (timestamptz, default now())

RLS: Doctores pueden INSERT (su propio doctor_id). Admins pueden SELECT y UPDATE.

**Tabla `hospitals`**:
- `id`, `name`, `phone`, `email`, `address`, `city_id` (uuid nullable FK), `zone_id` (uuid nullable FK), `is_active` (bool default true), `created_at`

RLS: Admins ALL. Authenticated SELECT.

**Tabla `laboratories`** — misma estructura que hospitals.

**Enum `post_consultation_status`**: 'pending', 'read', 'report_sent'

**Nuevo evento webhook**: Agregar `postconsultation.submitted` y `postconsultation.report_sent` a EVENT_GROUPS en Webhooks.tsx.

**Nuevo tipo de notificación**: Agregar `postconsultation_submitted` al enum `notification_type`.

---

### 2. Formulario Post-Consulta del Doctor (`PorCompletar.tsx`)

Reemplazar el card actual con un formulario estructurado:
- Campo "Observaciones de la consulta" (Textarea)
- 5 toggles con Switch, cada uno con animación de slide para mostrar/ocultar Textarea debajo:
  1. "Se recetaron medicamentos" → placeholder: "Nombres, dosis y frecuencia..."
  2. "Se solicitaron estudios de imagen" → placeholder: "Tipo de estudio..."
  3. "Se solicitaron análisis de laboratorio" → placeholder: "Tipo de análisis..."
  4. "Se refirió a otro especialista" → placeholder: "Especialidad y motivo..."
  5. "Se envió a hospitalización" → placeholder: "Hospital, motivo y urgencia..."
- Botón "Enviar formulario" (sin campos obligatorios)
- Al enviar:
  - INSERT en `post_consultation_forms`
  - UPDATE appointment status a 'completed', doctor_notes con las observaciones
  - INSERT notificación tipo `postconsultation_submitted` al admin
  - Invocar `dispatch-webhook` con evento `postconsultation.submitted`
  - Invalidar query para remover de la lista

---

### 3. Inbox del Admin (`Inbox.tsx`)

Extender para manejar formularios post-consulta:
- Nuevo tipo en TYPE_CONFIG: `postconsultation_submitted` con icono ClipboardList
- Al hacer clic en una notificación de tipo `postconsultation_submitted`, abrir un **nuevo dialog** (no el actual AppointmentDetailDialog) que muestre:
  - Info de la cita (paciente, doctor, especialidad, fecha, ciudad, zona)
  - Observaciones del doctor
  - Solo las acciones que el doctor activó con su detalle
  - Fecha/hora de envío del formulario
  - Badge de estado: "Pendiente" (amarillo), "Leído" (azul), "Informe enviado" (verde)
  - Botón "Marcar como leído" → actualiza `review_status` a 'read'
  - Botón "Enviar Informe" → abre modal de selección de destino

**Modal "Enviar Informe"**:
- Radio: "Hospital" / "Laboratorio"
- Dropdown con búsqueda de hospitales o laboratorios activos (nombre + ciudad/zona)
- Botón "Confirmar y enviar informe"
- Al confirmar: actualiza `review_status` a 'report_sent', guarda destino, dispara webhook `postconsultation.report_sent`

---

### 4. Catálogos — Tabs Hospitales y Laboratorios (`Catalogos.tsx`)

Agregar 2 tabs nuevos al TabsList: "Hospitales" y "Laboratorios".

Cada uno con:
- Tabla: Nombre, Ciudad, Zona, Estado, Acciones (editar, toggle)
- Botón "+ Agregar" → dialog con campos: Nombre*, Teléfono, Email, Dirección, Ciudad (dropdown), Zona (dropdown filtrada por ciudad)
- Editar y toggle de activo/inactivo
- Reusar patrones existentes de CitiesTab/ZonesTab

---

### 5. Webhooks — Nuevos eventos

Agregar al array EVENT_GROUPS en `Webhooks.tsx`:
```
{
  label: "Post-consulta",
  events: [
    { id: "postconsultation.submitted", label: "Post-consulta enviada" },
    { id: "postconsultation.report_sent", label: "Informe enviado" },
  ],
}
```

---

### 6. Archivos a crear/modificar

| Archivo | Accion |
|---------|--------|
| Migration SQL | Crear tablas hospitals, laboratories, post_consultation_forms, enum, notification_type update |
| `src/pages/doctor/PorCompletar.tsx` | Reescribir con nuevo formulario |
| `src/pages/admin/Catalogos.tsx` | Agregar tabs Hospitales y Laboratorios |
| `src/pages/admin/Inbox.tsx` | Agregar tipo postconsultation, dialog de detalle, modal enviar informe |
| `src/pages/admin/Webhooks.tsx` | Agregar grupo de eventos post-consulta |
| `src/components/admin/PostConsultationDetailDialog.tsx` | Nuevo componente para ver formulario y acciones |
| `src/components/admin/SendReportModal.tsx` | Nuevo modal para seleccionar destino del informe |

