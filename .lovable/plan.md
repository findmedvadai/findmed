## Plan completado ✅

### 1. ✅ Corregido timezone en reserve-slots
- Usa `Intl.DateTimeFormat` con `America/Mexico_City` para determinar "hoy" y hora actual
- Aplica `min_confirm_hours_before` del doctor como cutoff
- Devuelve flag `within_48h` en la respuesta

### 2. ✅ Auto-confirmar citas dentro de 48h
- `reserve-create` y `manage-reschedule` crean citas como `confirmed` si están dentro de 48h
- Las citas auto-confirmadas SÍ se pueden reagendar y cancelar

### 3. ✅ Permitir reagendar citas canceladas
- `manage-reschedule` ya no bloquea citas con status `cancelled`
- Solo cancela la cita vieja si no estaba ya cancelada

### 4. ✅ Nuevo webhook: Recordatorio del día de la cita
- `send-day-of-reminders` busca citas confirmadas del día en Mexico City
- Dispara `appointment.reminder_day_of` con manage_url
- Cron job configurado: diario a las 14:00 UTC (8:00am Mexico City)
- Evento agregado en Webhooks.tsx
