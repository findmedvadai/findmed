

## Agregar fallback de zona al endpoint search-doctors

### Que cambia

Cuando se envia una zona y no hay doctores que coincidan con ciudad + especialidad + zona, el endpoint automaticamente vuelve a buscar solo con ciudad + especialidad (sin zona) y devuelve todos los resultados disponibles. La respuesta incluye un campo `fallback` que indica si se uso el fallback o no.

### Flujo con fallback

```text
1. Buscar por ciudad + especialidad + zona
2. Si hay resultados -> devolver con fallback: false
3. Si NO hay resultados -> buscar por ciudad + especialidad (sin zona)
4. Devolver resultados con fallback: true
```

### Ejemplo de respuesta con fallback

```json
{
  "success": true,
  "total": 3,
  "fallback": true,
  "fallback_reason": "No se encontraron doctores en la zona 'Pedregal'. Mostrando todos los doctores de la especialidad en la ciudad.",
  "doctors": [
    {
      "id": "uuid",
      "full_name": "Dr. Juan Perez",
      "phone": "+525512345678",
      "address": "Av. Insurgentes 100",
      "city": "Ciudad de México",
      "zone": "Roma Norte",
      "specialties": ["Gastroenterólogo"]
    }
  ]
}
```

Si la busqueda original (con zona) encuentra resultados, `fallback` sera `false` y no habra `fallback_reason`.

### Detalle tecnico

**Archivo modificado**: `supabase/functions/search-doctors/index.ts`

- Despues de la busqueda con zona, si `result.length === 0` y se envio zona, se ejecuta una segunda busqueda sin el filtro de zona
- Se agregan los campos `fallback` (boolean) y `fallback_reason` (string, solo cuando fallback es true) a la respuesta JSON
- El resto de la logica (autenticacion, filtrado por ciudad/especialidad, formato de respuesta) permanece igual

