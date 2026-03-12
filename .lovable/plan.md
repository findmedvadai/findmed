

## Problema

Todas las edge functions usan como fallback la URL de preview (`id-preview--f06cae85-...lovable.app`) cuando no existe el secret `APP_URL`. Esta URL requiere autenticación de Lovable para abrirse, por lo que los pacientes no pueden acceder a los links de reserva/gestión.

La app ya está publicada en `https://findmed.lovable.app`.

## Solución

Cambiar el fallback en **11 archivos** de edge functions, reemplazando:
```
https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app
```
por:
```
https://findmed.lovable.app
```

### Archivos a modificar

1. `supabase/functions/triage-webhook/index.ts`
2. `supabase/functions/reserve-create/index.ts`
3. `supabase/functions/generate-manage-link/index.ts`
4. `supabase/functions/send-appointment-reminders/index.ts`
5. `supabase/functions/send-day-of-reminders/index.ts`
6. `supabase/functions/update-appointment-status/index.ts`
7. `supabase/functions/confirm-appointment/index.ts`
8. `supabase/functions/auto-cancel-unconfirmed/index.ts`
9. `supabase/functions/manage-cancel/index.ts`
10. `supabase/functions/manage-reschedule/index.ts`
11. `supabase/functions/cancel-by-doctor/index.ts`

En cada archivo, el cambio es idéntico: una sustitución de string en la línea donde se define `baseUrl` o se usa inline el fallback.

Adicionalmente, se recomienda configurar el secret `APP_URL` con valor `https://findmed.lovable.app` para que no dependa del fallback hardcodeado.

