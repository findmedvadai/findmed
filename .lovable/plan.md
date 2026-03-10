

## Fix: Desplegar google-calendar-callback y corregir URL de redireccion

### Problema 1: Funcion no desplegada
La funcion `google-calendar-callback` existe en el codigo pero no esta desplegada en produccion. Por eso Google muestra `{"code":"NOT_FOUND","message":"Requested function was not found"}`.

### Problema 2: URL de redireccion incorrecta
El fallback de `SITE_URL` en la funcion apunta a `https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app`, pero la app realmente corre en `https://f06cae85-4014-499a-b2cc-40cce2aba6c6.lovableproject.com`. Esto haria que el redirect despues de conectar Google lleve a una URL que no existe.

### Cambios

**1. Corregir URL en** `supabase/functions/google-calendar-callback/index.ts`
- Cambiar el fallback de SITE_URL de `https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app` a `https://f06cae85-4014-499a-b2cc-40cce2aba6c6.lovableproject.com`
- Esto aplica en la linea 15 y la linea 76

**2. Desplegar la funcion**
- Redesplegar `google-calendar-callback` para que este activa y responda correctamente

### Resultado esperado
1. Google redirige al callback → la funcion procesa el token → redirige a `/google-calendar-success` en la app React
2. La pagina React muestra el checkmark verde, envia postMessage al opener, y se cierra automaticamente
3. La ventana padre detecta la conexion y refresca la lista de calendarios
