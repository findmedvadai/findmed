

## Crear endpoint seguro para buscar doctores desde n8n

### Que se va a hacer

Crear una backend function llamada `search-doctors` que reciba ciudad, especialidad y zona (opcional) como parametros, y devuelva los doctores que coincidan. n8n solo necesita hacer un POST HTTP con API key, sin exponer credenciales de base de datos.

### Como funciona el flujo en n8n

```text
[Datos del paciente] --> [HTTP Request POST] --> search-doctors --> [Doctores encontrados]
```

n8n envia:
```json
{
  "ciudad": "Ciudad de México",
  "especialidad": "Gastroenterólogo",
  "zona": "Pedregal"
}
```

La function responde:
```json
{
  "success": true,
  "total": 1,
  "doctors": [
    {
      "id": "uuid-del-doctor",
      "full_name": "Dr. Juan Perez",
      "phone": "+525512345678",
      "address": "Av. Insurgentes 100",
      "city": "Ciudad de México",
      "zone": "Pedregal",
      "specialties": ["Gastroenterólogo"]
    }
  ]
}
```

### Logica de filtrado

1. Filtra doctores activos (`is_active = true`, `is_deleted = false`)
2. Filtra por ciudad (ILIKE para ignorar mayusculas/acentos)
3. Filtra por especialidad (ILIKE) via join con `doctor_specialties` y `specialties`
4. Si se envia zona, filtra tambien por zona (ILIKE) via join con `zones`
5. Ordena por zona para facilitar la seleccion del paciente

### Seguridad

Usa el mismo patron de API key (`Bearer fm_...`) que ya usan `triage-webhook`, `confirm-appointment`, etc. n8n ya tiene esta API key configurada.

### Configuracion en n8n

- **Nodo**: HTTP Request
- **Metodo**: POST
- **URL**: `https://iepdgygvztocornqkkhk.supabase.co/functions/v1/search-doctors`
- **Headers**:
  - `Content-Type`: `application/json`
  - `Authorization`: `Bearer fm_TU_API_KEY`
- **Body**: JSON con `ciudad`, `especialidad`, y opcionalmente `zona`

---

### Detalle tecnico

**Archivo nuevo**: `supabase/functions/search-doctors/index.ts`

- Validacion de API key con hash SHA-256 contra tabla `api_keys` (mismo patron que `triage-webhook`)
- Metodo POST, requiere `ciudad` y `especialidad`; `zona` es opcional
- Usa service role key para queries internos (bypasa RLS)
- Join de 4 tablas: `doctors` -> `cities`, `doctors` -> `zones`, `doctor_specialties` -> `specialties`
- Respuesta incluye id, full_name, phone, address, city, zone, y array de specialties

**Archivo modificado**: `supabase/config.toml`

- Agregar `[functions.search-doctors]` con `verify_jwt = false`

