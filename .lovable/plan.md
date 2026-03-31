

## Problema

La función `google-calendar-callback` tiene el fallback de `SITE_URL` apuntando a la URL de preview (`https://f06cae85-4014-499a-b2cc-40cce2aba6c6.lovableproject.com`) en lugar de la URL publicada. Como el secret `SITE_URL` no está configurado, usa ese fallback y redirige a una URL que requiere autenticación de Lovable — causando el error 404.

Es el mismo problema que corregimos en las otras edge functions, pero esta función se nos pasó.

## Solución

Cambiar el fallback en **`supabase/functions/google-calendar-callback/index.ts`** en dos líneas:

- **Línea 15**: `"https://f06cae85-...lovableproject.com"` → `"https://findmed.lovable.app"`
- **Línea 76**: Mismo cambio

No se requieren otros cambios — la ruta `/google-calendar-success` ya existe en el router y el componente funciona correctamente.

