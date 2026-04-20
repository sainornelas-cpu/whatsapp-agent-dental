/**
 * Módulo de recordatorios para Clínica Dental
 * Envío de confirmaciones y recordatorios por WhatsApp
 */

import { supabaseServer } from './supabase'

/**
 * Envía un mensaje por WhatsApp Cloud API
 */
async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const whatsappUrl = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`

    const response = await fetch(whatsappUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phoneNumber,
        text: { body: message },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('WhatsApp API error:', response.status, errorText)
      return {
        success: false,
        error: `Error ${response.status}: ${errorText}`,
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception sending WhatsApp message:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Formatea el mensaje de confirmación de cita
 */
export function formatConfirmationMessage(appointment: any): string {
  const date = new Date(appointment.appointment_date)
  const endDate = new Date(appointment.end_time)

  const formatDate = (d: Date) => {
    return d.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const patientName = appointment.patient?.full_name || 'Paciente'

  return `
✅ **CITA CONFIRMADA**

Hola ${patientName}, tu cita ha sido confirmada:

📅 **Fecha:** ${formatDate(date)}
⏰ **Hora:** ${formatTime(date)} - ${formatTime(endDate)}
🦷 **Servicio:** ${appointment.service?.name}
💰 **Precio:** $${appointment.service?.price} MXN
📍 **Ubicación:** Clínica Dental Sonrisas
📱 **Teléfono:** +52 551 234 5678

---
⚠️ **IMPORTANTE:**
• Llega 15 minutos antes
• Si no puedes asistir, avísanos con 24h de anticipación
• Trae tu identificación oficial
• Si tienes seguro, trae tu póliza

¿Necesitas algo más?
  `.trim()
}

/**
 * Envía confirmación de cita por WhatsApp
 */
export async function sendConfirmation(
  appointmentId: string,
  appointment: any
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // Obtener número de teléfono del paciente
    const patientPhone = appointment.patient?.phone_number

    if (!patientPhone) {
      return {
        success: false,
        error: 'No se encontró número de teléfono del paciente',
      }
    }

    // Formatear mensaje
    const message = formatConfirmationMessage(appointment)

    // Enviar por WhatsApp
    const result = await sendWhatsAppMessage(patientPhone, message)

    if (!result.success) {
      return result
    }

    // Actualizar la cita con fecha de confirmación
    const { error: updateError } = await supabaseServer
      .from('appointments')
      .update({
        status: 'confirmed',
        confirmation_sent_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)

    if (updateError) {
      console.error('Error updating appointment confirmation:', updateError)
    }

    // Crear registro de recordatorio de confirmación
    await supabaseServer.from('reminders').insert({
      appointment_id: appointmentId,
      reminder_type: 'confirmation',
      status: 'sent',
      scheduled_for: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      message: message.substring(0, 500), // Guardar primeros 500 caracteres
    })

    return { success: true }
  } catch (error) {
    console.error('Exception sending confirmation:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Formatea el mensaje de recordatorio
 */
function formatReminderMessage(appointment: any, type: '24h_before' | '1h_before'): string {
  const date = new Date(appointment.appointment_date)

  const formatDate = (d: Date) => {
    return d.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const patientName = appointment.patient?.full_name || 'Paciente'

  let message = ''

  if (type === '24h_before') {
    message = `
🔔 **RECORDATORIO DE CITA**

Hola ${patientName},

Te recordamos que tienes una cita mañana:

📅 ${formatDate(date)}
🦷 ${appointment.service?.name}
📍 Clínica Dental Sonrisas

Por favor llega puntual y avísanos si no puedes asistir.
    `.trim()
  } else if (type === '1h_before') {
    message = `
⏰ **TU CITA ES EN 1 HORA**

Hola ${patientName},

Tu cita comienza en una hora:

📅 ${formatDate(date)}
🦷 ${appointment.service?.name}
📍 Clínica Dental Sonrisas

¡Te esperamos!
    `.trim()
  }

  return message
}

/**
 * Agenda un recordatorio de cita
 */
export async function scheduleReminder(
  appointmentId: string,
  appointment: any,
  type: '24h_before' | '1h_before'
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const appointmentDate = new Date(appointment.appointment_date)
    const now = new Date()

    // Calcular cuándo enviar el recordatorio
    let scheduledFor: Date = new Date()

    if (type === '24h_before') {
      scheduledFor = new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000)
    } else if (type === '1h_before') {
      scheduledFor = new Date(appointmentDate.getTime() - 60 * 60 * 1000)
    }

    // Si el recordatorio ya pasó, no programar
    if (scheduledFor < now) {
      console.log('Reminder time already passed, skipping')
      return {
        success: false,
        error: 'El tiempo del recordatorio ya pasó',
      }
    }

    // Crear registro de recordatorio pendiente
    const { error: insertError } = await supabaseServer.from('reminders').insert({
      appointment_id: appointmentId,
      reminder_type: type,
      status: 'pending',
      scheduled_for: scheduledFor.toISOString(),
    })

    if (insertError) {
      console.error('Error inserting reminder:', insertError)
      return {
        success: false,
        error: 'Error al programar recordatorio',
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception scheduling reminder:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Envía recordatorios pendientes
 * Esta función debe ejecutarse periódicamente (cada hora)
 */
export async function sendPendingReminders(): Promise<{
  sent: number
  failed: number
  error?: string
}> {
  try {
    // Buscar recordatorios pendientes que ya es tiempo de enviar
    const now = new Date()

    const { data: reminders, error } = await supabaseServer
      .from('reminders')
      .select('*, appointment:appointments(*, patient:patients(*))')
      .eq('status', 'pending')
      .lte('scheduled_for', now.toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50)

    if (error) {
      return {
        sent: 0,
        failed: 0,
        error: 'Error al obtener recordatorios pendientes',
      }
    }

    let sentCount = 0
    let failedCount = 0

    for (const reminder of (reminders || [])) {
      try {
        const patientPhone = reminder.appointment?.patient?.phone_number

        if (!patientPhone) {
          console.error('No phone for reminder:', reminder.id)
          continue
        }

        let message = ''

        if (reminder.reminder_type === 'confirmation') {
          message = formatConfirmationMessage(reminder.appointment)
        } else {
          message = formatReminderMessage(
            reminder.appointment,
            reminder.reminder_type as '24h_before' | '1h_before'
          )
        }

        // Enviar mensaje
        const result = await sendWhatsAppMessage(patientPhone, message)

        if (result.success) {
          // Actualizar recordatorio como enviado
          await supabaseServer
            .from('reminders')
            .update({
              status: 'sent',
              sent_at: now.toISOString(),
              message: message.substring(0, 500),
            })
            .eq('id', reminder.id)

          sentCount++
        } else {
          // Actualizar recordatorio como fallido
          await supabaseServer
            .from('reminders')
            .update({
              status: 'failed',
              error_message: result.error?.substring(0, 500),
            })
            .eq('id', reminder.id)

          failedCount++
        }
      } catch (e) {
        console.error('Error processing reminder:', reminder.id, e)
        failedCount++
      }
    }

    return {
      sent: sentCount,
      failed: failedCount,
    }
  } catch (error) {
    console.error('Exception sending pending reminders:', error)
    return {
      sent: 0,
      failed: 0,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Cancela recordatorios pendientes de una cita
 */
export async function cancelPendingReminders(
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseServer
      .from('reminders')
      .update({ status: 'cancelled' })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')

    if (error) {
      return {
        success: false,
        error: 'Error al cancelar recordatorios',
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception canceling reminders:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}
