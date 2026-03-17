
Objetivo: corregir definitivamente `search-doctors` para que la respuesta incluya la zona del doctor y deje de depender de joins anidados que están devolviendo `null` en ese endpoint.

Qué encontré:
- La data sí existe en la base: hay doctores con `zone_id` y su `zones.name` correspondiente.
- El problema no parece ser de catálogo ni de foreign keys faltantes.
- El punto frágil está en la edge function `search-doctors`: hoy arma la respuesta con joins anidados (`cities!inner(name), zones(name)`) y luego lee `d.zones?.name`. En este endpoint ese join no está resolviendo de forma consistente, por eso sale `null` aunque el doctor sí tenga zona.

Plan de implementación:
1. Reescribir la obtención de doctores en `supabase/functions/search-doctors/index.ts` para no depender de `zones(name)` ni `cities(name)` en la query principal.
2. Hacer la búsqueda principal de doctores con campos directos:
   - `id`
   - `full_name`
   - `phone`
   - `address`
   - `city_id`
   - `zone_id`
3. Mantener la lógica de especialidad como está.
4. Cambiar el filtro por ciudad/zona a una estrategia más robusta:
   - resolver ciudad y zona desde sus tablas
   - filtrar por `city_id` y `zone_id` en lugar de filtrar por relaciones anidadas
5. Construir mapas de catálogos:
   - `cityId -> cityName`
   - `zoneId -> zoneName`
6. Formatear la respuesta final usando esos mapas, para que `zone` salga desde `zone_id` real del doctor.
7. Conservar el fallback actual:
   - si mandan `zona` y no hay resultados, devolver doctores de la ciudad sin restringir por zona
   - incluir `fallback_reason`

Resultado esperado:
- Si el doctor tiene `zone_id`, la respuesta devolverá `"zone": "Nombre de la zona"`.
- Solo vendrá `null` cuando el doctor realmente no tenga zona asignada.

Detalles técnicos:
- No hace falta migración de esquema.
- No hace falta tocar frontend.
- El cambio queda encapsulado en una sola edge function.
- Esta solución también evita futuros problemas por joins ambiguos o serialización distinta de relaciones en funciones backend.

Validación después del cambio:
1. Probar `search-doctors` con una ciudad, especialidad y zona donde ya sabes que existen doctores.
2. Confirmar que en la respuesta los doctores regresan con:
   - `city` poblado
   - `zone` poblado
3. Repetir prueba con una zona inexistente para validar que:
   - `fallback = true`
   - los doctores sigan trayendo su zona correcta
