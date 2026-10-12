# Estado de ejecución

> Actualizar al cerrar cada bloque y antes de interrumpir el trabajo. Al retomar: leer este archivo, `decisiones.md`
> y los hallazgos del bloque en curso; no depender de un resumen de conversación.

**Rama**: `feat/whaapy-mcp-migration` (desde `main` = `9ed5aa5`).
**Último bloque cerrado**: B0 — diagnóstico, conciliación y cobertura persistente (12-oct-2026).
**Bloque en curso**: B2-bis — regla D2 (bloqueo por doctor) en migración y validadores.

## Siguiente acción concreta
1. Cambiar la exclusión de `supabase/migrations/20261012120000_booking_integrity_and_cron.sql` a `doctor_id` (D2) y dejar lista
   la consulta de solapamientos existentes por doctor para correrla cuando vuelva el acceso.
2. `_shared/slot-validation.ts`: scope doctor por defecto; `reserve-slots`: incluir citas del doctor en otras sedes.
3. B1: alias de ciudad/especialidad y resultado none/one/many en `search-doctors`.

## Pendientes de prueba
P-001–P-004 → convertir a `deno test` versionado. R18/R25 requieren Supabase local con la migración.

## Bloqueos y decisiones necesarias

| Tipo | Detalle | Quién | Bloquea |
|---|---|---|---|
| Acceso | 403 en Supabase `jyzvdowflblxmlahlupo` | Alex | Verificación de prod, migraciones, deploy |
| Permisos | Reglas para `functions deploy`, `db push`, `git push --force` | Alex | Deploy desde Claude Code |
| Seguridad | Rotar key legacy (Vault → `sb_secret_`, desactivar legacy, revocar JWT secret) | Alex + Claude | N01 |
| Seguridad | Reset de las ~52 contraseñas expuestas | Alex/FindMed | N02 |
| Acceso | Host y permisos del Postgres Vadai (`triage_findmed`) | Alex | M02, F10 |
| WHAAPY | Número/contactos de prueba, token API, acceso a configurar agente/automatizaciones | Alex | B5 (IR), B6, B7, B8 |
| Negocio | Cobertura real de ciudades (prompt: CDMX+QRO; catálogo: 9) | FindMed | R07, prompt B8 |
| Negocio | Texto y reglas de urgencia aprobados | Responsable clínico FindMed | R08, B8 |
| Negocio | Alcance del servicio de ambulancias y del menú de bienvenida (17 nodos "pendiente") | FindMed | B8 |
| Negocio | EV05 (día de vs "mañana") y EV07 (solicitud vs envío) | FindMed | B7 |
| Documentación | Especificación Findi v2.0 / T01–T30 | Alex | B9 |

## Bitácora de bloques

| Fecha | Bloque | Resultado | Evidencia |
|---|---|---|---|
| 12-oct | Previo (main) | Seguridad, agenda, crons, keys, docs; `seed-admin` eliminada en prod | commits en `main` hasta `9ed5aa5`; `hallazgos.md` N01–N10 |
| 12-oct | B0 | Lectura completa del plan (1,407 líneas) y del export (117 nodos); diagnóstico, D1–D4, A1–A9, cobertura, inventario de nodos, suite de pruebas | archivos de `docs/findmed-migration/` |
