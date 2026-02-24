

## Validar formato de email antes de enviar el formulario

### Que cambia

Agregar validacion de formato de email en el formulario de crear doctor para que el usuario vea un mensaje claro si el correo no tiene un formato valido (ej. falta el `@` o el dominio), antes de que se envie al backend.

### Comportamiento

- Al hacer clic en "Crear Doctor", si el email no tiene formato valido, se muestra un toast: **"El correo electrónico no tiene un formato válido (ej. doctor@findmed.com)"**
- No se hace la llamada al backend hasta que el formato sea correcto
- Se valida con una expresion regular simple que verifica `algo@algo.algo`

### Detalle tecnico

**Archivo modificado**: `src/pages/admin/Doctores.tsx`

- En la funcion `handleCreate`, agregar una validacion de formato de email despues del check de campos obligatorios
- Usar regex basica: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Si no pasa, mostrar toast descriptivo con ejemplo del formato esperado y hacer `return` antes de llamar al backend
