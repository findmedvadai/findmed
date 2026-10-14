# Plantilla de WhatsApp `alerta_caso_findmed` (alertas al equipo)

Plantilla que FindMed envía por la API de WHAAPY a los **números de guardia**
(Configuración → Alertas) cuando un caso necesita a una persona:

- se abre un caso **urgente** o de prioridad **alta**;
- el agente pide hablar con una persona (`request_handoff`);
- un caso sigue sin que nadie lo tome después de su tiempo de respuesta
  (re-aviso; urgente 10 min, alta 30 min, normal 120 min, hasta 3 veces —
  configurable).

El aviso en el panel (aviso fijo con “Ver caso”, sonido y notificación del
navegador) llega **siempre**, exista o no esta plantilla. Si la plantilla no
existe o no está aprobada, cada envío queda como **fallido** con el motivo y
aparece en Inicio → Por resolver y en Configuración → Alertas.

## Datos para darla de alta en WHAAPY / Meta

| Campo | Valor |
|---|---|
| Nombre | `alerta_caso_findmed` (si se usa otro, cambiarlo en Configuración → Alertas) |
| Categoría | **Utilidad (UTILITY)** — aviso operativo interno, sin contenido promocional |
| Idioma | Español (México) — `es_MX` |
| Encabezado | Ninguno |
| Pie (opcional) | `Aviso interno del equipo FindMed` |

### Cuerpo

```
Alerta del equipo FindMed: un caso de {{1}} con prioridad {{2}} espera que alguien lo tome.
Resumen: {{3}}
Lleva {{4}} minutos esperando. Ábrelo en el panel para atenderlo.
```

| Variable | Qué lleva | Ejemplo para la revisión de Meta |
|---|---|---|
| `{{1}}` | Tipo de caso | `Estudios` |
| `{{2}}` | Prioridad | `Urgente` |
| `{{3}}` | Resumen corto del caso (máx. 120 caracteres, una línea) | `Paciente busca laboratorio para biometría hemática en Querétaro` |
| `{{4}}` | Minutos esperando desde que se abrió el caso | `12` |

Las variables van en ese orden y exactamente 4: FindMed valida la plantilla
contra el catálogo de WHAAPY antes de enviar.

### Botón

| Tipo | Texto | URL |
|---|---|---|
| Enlace (URL) **dinámico** — debe ser el **primer** botón | `Ver caso` | `https://app.findmed.com.mx/admin/casos?caso={{1}}` |

Ejemplo de URL para la revisión: `https://app.findmed.com.mx/admin/casos?caso=3f2a9c1e-7b4d-4e0a-9d61-2c8f5b7a1e90`.
El `{{1}}` del botón es el id del caso; el enlace abre el panel (con inicio de
sesión) directamente en ese caso. Si la plantilla se aprueba sin botón, FindMed
la envía igual, sin enlace.

## Qué datos viajan (y cuáles no)

Solo tipo, prioridad, el resumen corto (≤ 120 caracteres) y los minutos de
espera. **No** se envían nombre ni teléfono del paciente ni ningún otro dato
clínico; para verlos hay que entrar al panel con usuario y contraseña.

## Alerta de prueba

En Configuración → Alertas, “Enviar prueba” manda esta plantilla al número
elegido con: `{{1}} = Prueba`, `{{2}} = Normal`,
`{{3}} = Mensaje de prueba de las alertas de FindMed. No requiere ninguna acción.`,
`{{4}} = 0` y el botón con `caso=prueba`. Si la plantilla aún no existe o no
está aprobada, la prueba lo dice con el motivo exacto.

## Pasos

1. Crear la plantilla en WHAAPY con los datos de arriba y enviarla a revisión de Meta.
2. Cuando esté aprobada, en WHAAPY sincronizar plantillas (o esperar la sincronización).
3. En FindMed → Configuración → Alertas: agregar los números de guardia
   (“Todas las alertas” o “Solo urgentes”), revisar los tiempos y pulsar
   “Enviar prueba” en cada número.
4. Pedir a cada persona del equipo que active los avisos del navegador en la
   misma pestaña (botón “Activar avisos del navegador”).
