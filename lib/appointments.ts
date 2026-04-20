/**
 * Módulo de manejo de citas para Clínica Dental
 * Funciones para crear, verificar y gestionar citas
 */

import { supabaseServer, Appointment, Service, Patient } from './supabase'

/**
 * Crea una nueva cita en el sistema
 */
export async function createAppointment(params: {
  patient_phone: string
  patient_name?: string
  service_name: string
  appointment_date: Date
}): Promise<{
  success: boolean
  appointment?: Appointment
  error?: string
}> {
  try {
    // 1. Obtener o crear paciente
    const { data: patientData, error: patientError } = await supabaseServer.rpc('get_or_create_patient', {
      phone_num: params.patient_phone,
      patient_name: params.patient_name || null,
    })

    if (patientError || !patientData) {
      return {
        success: false,
        error: 'No se pudo crear el paciente',
      }
    }

    const patientId = patientData as string

    // 2. Buscar el servicio por nombre
    const { data: serviceData, error: serviceError } = await supabaseServer
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('is_active', true)
      .ilike('name', `%${params.service_name}%`)
      .limit(1)
      .single()

    if (serviceError || !serviceData) {
      return {
        success: false,
        error: 'Servicio no encontrado',
      }
    }

    const service = serviceData as Service
    const serviceId = service.id

    // 3. Calcular hora de fin
    const endDate = new Date(params.appointment_date.getTime() + service.duration_minutes * 60000)

    // 4. Crear la cita
    const { data: appointmentData, error: appointmentError } = await supabaseServer
      .from('appointments')
      .insert({
        patient_id: patientId,
        service_id: serviceId,
        appointment_date: params.appointment_date.toISOString(),
        end_time: endDate.toISOString(),
        status: 'pending',
        consultation_type: 'in_person',
      })
      .select('*, patient:patients(*), service:services(*)')
      .single()

    if (appointmentError || !appointmentData) {
      return {
        success: false,
        error: 'No se pudo crear la cita',
      }
    }

    return {
      success: true,
      appointment: appointmentData as any,
    }
  } catch (error) {
    console.error('Error creating appointment:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Verifica disponibilidad para una fecha y duración
 */
export async function checkAvailability(
  date: Date,
  durationMinutes: number
): Promise<{
  available: boolean
  message: string
}> {
  try {
    const { data, error } = await supabaseServer.rpc('check_availability', {
      requested_date: date.toISOString(),
      duration_minutes: durationMinutes,
    })

    if (error) {
      console.error('Error checking availability:', error)
      return {
        available: false,
        message: 'Error al verificar disponibilidad',
      }
    }

    // El RPC retorna true si hay disponibilidad
    return {
      available: data === true,
      message: data === true
        ? '✅ Hay disponibilidad para esa fecha'
        : '❌ No hay disponibilidad para esa fecha. ¿Te gustaría ver otras opciones?',
    }
  } catch (error) {
    console.error('Exception checking availability:', error)
    return {
      available: false,
      message: 'Error interno del servidor',
    }
  }
}

/**
 * Obtiene los slots disponibles para una fecha
 */
export async function getAvailableSlots(
  date: Date,
  durationMinutes: number = 30
): Promise<{
  success: boolean
  slots?: Array<{ start: string; end: string; dentist?: string }>
  error?: string
}> {
  try {
    const dateString = date.toISOString().split('T')[0]

    const { data, error } = await supabaseServer.rpc('get_available_slots', {
      target_date: dateString,
      duration_minutes: durationMinutes,
    })

    if (error) {
      console.error('Error getting available slots:', error)
      return {
        success: false,
        error: 'Error al obtener horarios disponibles',
      }
    }

    return {
      success: true,
      slots: data || [],
    }
  } catch (error) {
    console.error('Exception getting available slots:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Obtiene todos los servicios activos
 */
export async function getActiveServices(): Promise<{
  success: boolean
  services?: Service[]
  error?: string
}> {
  try {
    const { data, error } = await supabaseServer
      .from('services')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) {
      return {
        success: false,
        error: 'Error al obtener servicios',
      }
    }

    return {
      success: true,
      services: data as Service[],
    }
  } catch (error) {
    console.error('Exception getting services:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Obtiene servicios por categoría
 */
export async function getServicesByCategory(category: string): Promise<{
  success: boolean
  services?: Service[]
  error?: string
}> {
  try {
    const { data, error } = await supabaseServer
      .from('services')
      .select('*')
      .eq('is_active', true)
      .eq('category', category)
      .order('sort_order', { ascending: true })

    if (error) {
      return {
        success: false,
        error: 'Error al obtener servicios',
      }
    }

    return {
      success: true,
      services: data as Service[],
    }
  } catch (error) {
    console.error('Exception getting services by category:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Obtiene información de un paciente por número de teléfono
 */
export async function getPatientByPhone(phoneNumber: string): Promise<{
  success: boolean
  patient?: Patient
  error?: string
}> {
  try {
    const { data, error } = await supabaseServer
      .from('patients')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          success: true,
          patient: undefined, // Paciente no existe
        }
      }
      return {
        success: false,
        error: 'Error al obtener paciente',
      }
    }

    return {
      success: true,
      patient: data as Patient,
    }
  } catch (error) {
    console.error('Exception getting patient:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Actualiza el estado de una cita
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: Appointment['status'],
  cancellationReason?: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (status === 'cancelled' || status === 'cancelled_clinic') {
      updateData.cancelled_at = new Date().toISOString()
      updateData.cancellation_reason = cancellationReason || null
    }

    const { error } = await supabaseServer
      .from('appointments')
      .update(updateData)
      .eq('id', appointmentId)

    if (error) {
      return {
        success: false,
        error: 'Error al actualizar cita',
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Exception updating appointment status:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Obtiene citas de un paciente
 */
export async function getPatientAppointments(
  phoneNumber: string
): Promise<{
  success: boolean
  appointments?: Appointment[]
  error?: string
}> {
  try {
    // Primero obtener el paciente
    const { data: patient, error: patientError } = await supabaseServer
      .from('patients')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single()

    if (patientError || !patient) {
      return {
        success: true,
        appointments: [],
      }
    }

    const patientId = patient.id

    // Obtener citas del paciente
    const { data: appointments, error: appointmentsError } = await supabaseServer
      .from('appointments')
      .select('*, service:services(*), patient:patients(*)')
      .eq('patient_id', patientId)
      .order('appointment_date', { ascending: false })
      .limit(10)

    if (appointmentsError) {
      return {
        success: false,
        error: 'Error al obtener citas',
      }
    }

    return {
      success: true,
      appointments: appointments as Appointment[],
    }
  } catch (error) {
    console.error('Exception getting patient appointments:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}

/**
 * Formatea una cita para mostrar al usuario
 */
export function formatAppointment(appointment: any): string {
  const date = new Date(appointment.appointment_date)
  const endDate = new Date(appointment.end_time)

  const formatDate = (d: Date) => {
    return d.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  }

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    confirmed: '✅',
    cancelled: '❌',
    cancelled_clinic: '🏥',
    completed: '✨',
    no_show: '🚫',
    rescheduled: '📅',
  }

  const emoji = statusEmoji[appointment.status] || '📅'
  const serviceName = appointment.service?.name || 'No especificado'
  const price = appointment.service?.price || '0'

  return emoji + ' **' + appointment.status.toUpperCase() + '**}\n\n' +
    '📅 **Fecha:** ' + formatDate(date) + '\n' +
    '⏰ **Hora:** ' + formatTime(date) + ' - ' + formatTime(endDate) + '\n' +
    '🦷 **Servicio:** ' + serviceName + '\n' +
    '💰 **Precio:** $' + price + ' MXN'
}
