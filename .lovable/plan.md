

## Plan: Seleccion de Calendario y Visualizacion en Agenda

Hay dos problemas identificados:

1. **No se pregunta cual calendario conectar**: El callback (`google-calendar-callback`) automaticamente selecciona el calendario primario sin dar opcion al doctor.
2. **La Agenda no muestra eventos de Google Calendar**: La pagina de Agenda solo consulta la tabla `appointments` de la base de datos, no los eventos del Google Calendar conectado.

---

### Solucion Problema 1: Selector de Calendario

En lugar de auto-seleccionar el calendario primario en el callback, el flujo sera:

1. El callback almacena el `refresh_token` en la base de datos pero marca `google_calendar_connected = false` temporalmente (solo guarda el token).
2. Se crea una nueva edge function `google-calendar-list` que usa el refresh token para obtener un access token fresco y listar los calendarios disponibles del doctor.
3. En la pagina de Configuracion, despues de que el popup de OAuth se cierra, se muestra un selector (dropdown) con los calendarios disponibles del doctor para que elija cual usar.
4. Al seleccionar un calendario, se actualiza `google_calendar_id` y se marca `google_calendar_connected = true`.

### Solucion Problema 2: Mostrar Eventos de Google Calendar en Agenda

1. Se crea una nueva edge function `google-calendar-events` que:
   - Recibe el `doctor_id` y un rango de fechas
   - Usa el `refresh_token` almacenado para obtener un access token
   - Consulta la Google Calendar API para obtener los eventos del dia
   - Retorna los eventos formateados

2. En la pagina de Agenda se agrega una segunda query que llama a esta edge function para obtener los eventos de Google Calendar del dia seleccionado, y los muestra junto (o mezclados) con las citas de la base de datos.

---

### Detalle Tecnico

#### Archivos nuevos:
- `supabase/functions/google-calendar-list/index.ts` -- Lista calendarios del doctor usando su refresh token
- `supabase/functions/google-calendar-events/index.ts` -- Obtiene eventos de un rango de fechas

#### Archivos modificados:
- `supabase/functions/google-calendar-callback/index.ts` -- Guardar token sin auto-seleccionar calendario, marcar como "pendiente de seleccion"
- `src/pages/doctor/Configuracion.tsx` -- Agregar paso de seleccion de calendario despues del OAuth
- `src/pages/doctor/Agenda.tsx` -- Agregar seccion de eventos de Google Calendar
- `supabase/config.toml` -- Registrar las nuevas edge functions con `verify_jwt = false`

#### Flujo del usuario:
```text
1. Doctor hace clic en "Conectar Google Calendar"
2. Se abre popup de OAuth de Google
3. Doctor autoriza la app
4. Callback guarda el refresh_token en DB
5. Popup se cierra
6. Configuracion detecta que hay token pero no calendario seleccionado
7. Se muestra dropdown con calendarios disponibles
8. Doctor selecciona uno
9. Se guarda google_calendar_id y google_calendar_connected = true
```

#### Cambios en la base de datos:
- No se necesitan nuevas tablas ni columnas. Los campos existentes (`google_calendar_connected`, `google_calendar_id`, `google_refresh_token_ref`) son suficientes.

#### Seguridad:
- Las nuevas edge functions validan el JWT del doctor manualmente (mismo patron que `google-calendar-auth`)
- El refresh token solo se accede via service role key en las edge functions
- Los eventos de Google Calendar se obtienen server-side, nunca se expone el token al cliente

