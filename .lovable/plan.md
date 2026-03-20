

## Plan: Cambiar credenciales del admin

### Problema
El admin actual usa `admin@findmed.test`. Se necesita cambiar a `admin@findmed.com` con contraseña `Admin123!`.

### Pasos

1. **Crear edge function temporal `update-admin-email`** que use `supabase.auth.admin.updateUserById()` para:
   - Buscar el usuario con email `admin@findmed.test`
   - Actualizar su email a `admin@findmed.com`
   - Confirmar el email automáticamente
   - Actualizar también la tabla `users` si tiene campo email

2. **Invocar la función** para aplicar el cambio

3. **Actualizar `seed-admin/index.ts`** para que el email por defecto del admin sea `admin@findmed.com` (para futuros seeds)

4. **Eliminar la función temporal** después de ejecutarla

### Archivos modificados
- `supabase/functions/update-admin-email/index.ts` (crear, ejecutar, eliminar)
- `supabase/functions/seed-admin/index.ts` (actualizar email por defecto)

