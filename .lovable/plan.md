## Calendario del Admin - Vista global de citas con colores por especialidad

### Resumen

Construir la pagina completa del Calendario del admin que muestre todas las citas internas de todos los doctores en una vista semanal, con codificacion visual por especialidad (borde + texto de color, fondo blanco) y un indicador circular de estado (amarillo = agendada, verde = confirmada).

### Diseno visual de cada cita

```text
+----------------------------------+
|  [border-left color por espec.]  |
|  ● Nombre del paciente           |
|    09:00 - 09:30                 |
|    Dr. Garcia                    |
+----------------------------------+
```

- Rectangulo con fondo blanco y borde izquierdo grueso del color de la especialidad
- Texto del nombre del paciente y doctor en el color de la especialidad
- Circulo pequeno (6px) a la izquierda del nombre: amarillo (scheduled) o verde (confirmed)
- Citas canceladas/completadas se muestran con opacidad reducida

### Mapa de colores por especialidad

Se definira un mapa de colores predeterminados con al menos 8 colores distinguibles. Las especialidades se asignaran a colores por orden alfabetico o por ID. Colores iniciales propuestos:


| Especialidad      | Color (HSL)       | Hex aprox. |
| ----------------- | ----------------- | ---------- |
| Ginecologia       | Rosa (#E30050)    | Rosa CTA   |
| Gastroenterologia | Verde (#16A34A)   | Verde      |
| Cardiologia       | Rojo (#DC2626)    | Rojo       |
| Dermatologia      | Morado (#9333EA)  | Morado     |
| Pediatria         | Azul (#2563EB)    | Azul       |
| Oftalmologia      | Naranja (#EA580C) | Naranja    |
| Neurologia        | Teal (#0D9488)    | Teal       |
| Otras             | Gris (#6B7280)    | Gris       |


Los colores se asignan dinamicamente: se consultan todas las especialidades y se asigna un color del arreglo a cada una (por indice). Si hay mas especialidades que colores, se repiten ciclicamente.

### Estructura de datos y queries

1. **Citas**: `appointments` con join a `patients` (nombre) y `doctors` (nombre del doctor)
2. **Especialidades por doctor**: `doctor_specialties` con join a `specialties` (nombre) - se toma la primera especialidad del doctor como color representativo
3. **No se consulta** la edge function de Google Calendar (regla de exclusion)
4. **Filtros**: por especialidad, por doctor, por estado.

### Detalles tecnicos

**Archivos a crear:**

- `src/pages/admin/Calendario.tsx` - reescritura completa (actualmente placeholder)
- `src/lib/specialty-colors.ts` - mapa de colores y utilidad para asignar color por especialidad

**Archivos a modificar:**

- Ninguno adicional (la ruta ya existe en App.tsx)

**Componente Calendario.tsx:**

- Vista semanal con grid identico al de la Agenda del doctor (mismas constantes START_HOUR, END_HOUR, HOUR_HEIGHT)
- Reutiliza la logica de `computeOverlapColumns` (se extraera o duplicara)
- Header con navegacion de semana (anterior/siguiente/hoy)
- Filtro dropdown para seleccionar doctor especifico o "Todos"
- Cada rectangulo de cita:
  - `bg-white border-l-4` con el color de la especialidad
  - Texto en el color de la especialidad
  - Circulo de 6px: `bg-scheduled` (amarillo) si status=scheduled, `bg-confirmed` (verde) si status=confirmed
  - Para completed: opacidad reducida
- Click en cita abre un dialog de detalle (version simplificada, solo lectura para admin)

**Utilidad specialty-colors.ts:**

- Exporta un arreglo de colores HSL/hex
- Exporta una funcion `getSpecialtyColor(specialtyId, allSpecialties)` que retorna `{ border, text }` con clases CSS o valores inline
- Como las especialidades pueden variar, se usa inline styles con los colores del arreglo

**Query de datos:**

```typescript
// Citas de la semana para todos los doctores
supabase
  .from("appointments")
  .select(`
    id, start_at, end_at, status, symptoms,
    patients(full_name),
    doctors(id, full_name, doctor_specialties(specialty_id, specialties(id, name)))
  `)
  .gte("start_at", weekStart)
  .lte("start_at", weekEnd)
  .in("status", ["scheduled", "confirmed", "completed", "cancelled"])
  .order("start_at")
```

**Leyenda de colores:**

- Debajo de los contadores de resumen, una fila de badges mostrando cada especialidad con su color asignado para referencia rapida