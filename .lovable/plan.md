

## Fix: Google Calendar callback - redirigir a pagina React en vez de retornar HTML

### Problema

La edge function `google-calendar-callback` retorna HTML directamente, pero el navegador lo muestra como texto plano en vez de renderizarlo. Esto parece ser una limitacion de como se sirve el content-type en edge functions en ciertos navegadores/contextos.

### Nuevo approach

En vez de retornar HTML desde la edge function, **redirigir** a una pagina dentro de la app React que muestre la UI de exito. Esto garantiza que siempre se renderice correctamente.

### Cambios

**1. Nueva pagina React**: `src/pages/GoogleCalendarSuccess.tsx`
- Pagina simple que muestra el checkmark verde, mensaje de "Conexion exitosa!", countdown de 5 segundos y boton de cerrar
- Envia `postMessage` al opener para que la ventana padre refresque
- Auto-cierra con `window.close()` despues de 5 segundos
- No requiere autenticacion (es una pagina publica)

**2. Agregar ruta en** `src/App.tsx`
- Ruta `/google-calendar-success` que renderiza la nueva pagina
- Ruta publica, sin ProtectedRoute

**3. Modificar edge function** `supabase/functions/google-calendar-callback/index.ts`
- Despues de guardar el refresh token exitosamente, en vez de retornar HTML, hacer un **redirect 302** a la URL de la app: `{SITE_URL}/google-calendar-success`
- Para errores, redirigir a `/google-calendar-success?error=mensaje`
- La pagina React lee el query param `error` para mostrar error o exito

### Detalle tecnico

Edge function (cambio en la respuesta exitosa):
```typescript
// En vez de: return new Response(renderSuccessHTML(), { headers: { "Content-Type": "text/html" } })
// Ahora:
const siteUrl = Deno.env.get("SITE_URL") || "https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app";
return new Response(null, {
  status: 302,
  headers: { Location: `${siteUrl}/google-calendar-success` },
});
```

La pagina React tendra el mismo diseno que ya estaba en el HTML: checkmark SVG verde, titulo, mensaje, countdown y boton. Pero al ser una pagina React normal, se renderizara siempre correctamente.

