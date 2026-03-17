

## Problema

La columna `zone_id` en la tabla `doctors` no tiene una foreign key hacia `zones.id`. PostgREST (el motor detrás de las queries del SDK) necesita foreign keys para resolver joins como `zones(name)`. Sin la FK, el join siempre devuelve `null`.

Lo mismo aplica para `city_id` → `cities.id`, pero ese join funciona porque usas `cities!inner(name)` y probablemente sí existe implícitamente o hay otro mecanismo. Vamos a verificar y agregar ambas FKs si faltan.

## Solución

1. **Crear migración** para agregar foreign keys faltantes en `doctors`:
   - `doctors.zone_id → zones.id`
   - `doctors.city_id → cities.id` (si falta también)

```sql
ALTER TABLE public.doctors
  ADD CONSTRAINT doctors_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id),
  ADD CONSTRAINT doctors_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id);
```

2. **Sin cambios en código** — el query `zones(name)` en `search-doctors/index.ts` ya está correcto; solo necesita la FK para funcionar.

