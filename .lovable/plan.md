## Vista Semanal tipo Google Calendar para la Agenda

Se reemplazara la vista actual de lista diaria por una grilla semanal con franjas horarias, similar a Google Calendar / Google Classroom.

### Estructura Visual

```text
              DOM 8    LUN 9    MAR 10   MIE 11   JUE 12   VIE 13   SAB 14
             +--------+--------+--------+--------+--------+--------+--------+
  7:00 AM    |        |        |        |        |        |        |        |
             +--------+--------+--------+--------+--------+--------+--------+
  8:00 AM    |        |[Event] |        |        |        |[Cita]  |        |
             +--------+--------+--------+--------+--------+--------+--------+
  9:00 AM    |        |        |        |        |        |        |        |
             ...
```

### Cambios principales

**1. Navegacion por semana en vez de por dia**

- Los botones Prev/Next avanzan/retroceden una semana completa
- El header muestra los 7 dias de la semana actual (DOM-SAB)
- El dia actual se resalta con un circulo azul como en la imagen de referencia

**2. Consultas de datos para la semana completa**

- Las queries de appointments y Google Calendar events se ajustan para traer datos del rango de 7 dias (startOfWeek a endOfWeek)
- Se mantiene el polling de 60 segundos para Google Calendar

**3. Grilla de tiempo con posicionamiento absoluto**

- Eje Y: franjas horarias de 7 AM a 9 PM (configurable)
- Eje X: 7 columnas para cada dia de la semana
- Cada evento se posiciona con CSS absolute basado en su hora de inicio y su duracion determina la altura
- Las Citas agendadas se muestran de amarillo y las citas confirmadas se muestran de verde.
- Otros eventos del calendario se muestran en azul

**4. Eventos superpuestos**

- Si hay eventos que se superponen en el mismo horario, se dividen horizontalmente dentro de la columna del dia (similar a Google Calendar)

**5. Scroll vertical**

- La grilla es scrolleable verticalmente para ver todas las horas
- Se hace auto-scroll a la hora actual al cargar

### Detalle Tecnico

**Archivo modificado:** `src/pages/doctor/Agenda.tsx`

- Se reescribe el componente completo manteniendo las mismas queries de datos
- Se importan funciones adicionales de date-fns: `startOfWeek`, `endOfWeek`, `addWeeks`, `subWeeks`, `isSameDay`, `getDay`, `differenceInMinutes`
- Se calcula la posicion top de cada evento como: `(horaInicio - 7) * alturaPorHora` px
- Se calcula la altura de cada evento como: `duracionEnMinutos / 60 * alturaPorHora` px
- Cada columna de dia usa `position: relative` y los eventos dentro usan `position: absolute`
- Se elimina la seccion de "summary cards" para maximizar espacio de la grilla
- Se mantiene el header con titulo y navegacion (ahora semanal)
- La grilla se envuelve en un ScrollArea para el scroll vertical
- Altura por hora: 60px (cada franja horaria ocupa 60px)

**Sin cambios en:** edge functions, base de datos, ni otros componentes.