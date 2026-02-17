
## Agregar autenticación por API Key al triage-webhook

### Problema actual
`triage-webhook` está completamente abierto. Cualquiera que conozca la URL puede crear pacientes y sesiones de reserva falsas. El sistema de API Keys ya existe en la base de datos pero no se usa para proteger los endpoints.

### Solución
Modificar `triage-webhook/index.ts` para que valide el header `Authorization: Bearer <api_key>` contra la tabla `api_keys` antes de procesar la solicitud. También se actualizará el timestamp `last_used_at` de la key al usarla.

---

### Cambios tecnicos

**`supabase/functions/triage-webhook/index.ts`**

Agregar al inicio del handler (despues del check de OPTIONS/POST), antes de procesar el body:

1. Leer el header `Authorization` de la request
2. Verificar que tenga el formato `Bearer fm_...`
3. Calcular el SHA-256 hash de la clave recibida
4. Consultar la tabla `api_keys` donde `key_hash = hash AND is_active = true`
5. Si no se encuentra: responder `401 Unauthorized`
6. Si se encuentra: actualizar `last_used_at = now()` y continuar con el flujo normal

```
Header requerido en n8n:
Authorization: Bearer fm_TU_API_KEY_AQUI
```

---

### Configuracion en n8n

Una vez implementado, en el nodo HTTP Request de n8n que llama al triage-webhook, agregar:

- **Authentication**: Header Auth
- **Name**: `Authorization`
- **Value**: `Bearer fm_XXXXXXXXXXXXXXXX` (la API Key generada en la plataforma)

---

### Flujo completo

```text
n8n bot termina triaje
      |
      v
HTTP POST a triage-webhook
  Headers:
    Authorization: Bearer fm_abc123...
    Content-Type: application/json
  Body:
    { doctor_id, patient_name, patient_phone, symptoms }
      |
      v
triage-webhook valida API Key
  -> hash(fm_abc123...) == key_hash en BD?
  -> is_active == true?
      |
    Si no -> 401 Unauthorized
    Si si -> procesa y retorna reserve_url
```

---

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/triage-webhook/index.ts` | Agregar validacion de API Key por header Authorization |

Un cambio pequeno y puntual. No requiere migracion de base de datos ya que la tabla `api_keys` ya existe con los campos necesarios (`key_hash`, `is_active`, `last_used_at`).
