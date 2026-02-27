

## Fix: Redesplegar la edge function `google-calendar-callback`

### Problema

El archivo `google-calendar-callback/index.ts` ya contiene el HTML correcto con el diseno de exito (checkmark verde, mensaje claro, auto-cierre). Sin embargo, la version desplegada en produccion sigue siendo la version anterior que muestra el HTML sin renderizar.

### Solucion

Redesplegar la edge function `google-calendar-callback` para que la version actualizada este activa. No se requieren cambios de codigo — solo el despliegue.

### Resultado esperado

Despues del despliegue, al conectar Google Calendar el doctor vera:
- Un icono de check verde
- Titulo "Conexion exitosa!" en verde
- Mensaje indicando que ya puede cerrar la ventana y seleccionar su calendario
- Cuenta regresiva de 5 segundos con cierre automatico
- Boton "Cerrar ventana"

