import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseServer, Conversation, Message } from '@/lib/supabase'
import {
  generateRAGResponse,
  categorizeIntent,
  getOrCreatePatient,
} from '@/lib/rag'
import {
  createAppointment,
  checkAvailability,
  getAvailableSlots,
  getActiveServices,
  getPatientByPhone,
  updateAppointmentStatus,
} from '@/lib/appointments'
import { sendConfirmation, scheduleReminder, cancelPendingReminders } from '@/lib/reminders'
import fs from 'fs'
import path from 'path'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Load agent prompt from file
function getAgentPrompt(): string {
  try {
    const filePath = path.join(process.cwd(), 'AGENT_PROMPT_DENTAL.md')
    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error('Error reading AGENT_PROMPT_DENTAL.md:', error)
    return 'Eres un asistente de la Clínica Dental Sonrisas.'
  }
}

// Estado de conversación para agendamiento
interface ConversationState {
  patientName?: string
  serviceName?: string
  preferredDate?: string
  preferredTime?: string
  status: 'idle' | 'collecting_info' | 'confirming'
}

// Almacén de estados de conversación (en producción usar Redis)
const conversationStates = new Map<string, ConversationState>()

// GET handler - Meta webhook verification
export async function GET(request: NextRequest) {
  console.log('📥 Webhook GET request received')

  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully')
    return new NextResponse(challenge, { status: 200 })
  }

  console.log('❌ Webhook verification failed')
  return new NextResponse('Forbidden', { status: 403 })
}

// POST handler - Receive WhatsApp messages
export async function POST(request: NextRequest) {
  console.log('📨 Webhook POST request received')

  try {
    const body = await request.json()
    console.log('Received body:', JSON.stringify(body, null, 2))

    // Extract message from Meta's deeply nested payload
    const entry = body.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value

    if (!value?.messages) {
      console.log('⚠️ No messages in payload')
      return new NextResponse('OK', { status: 200 })
    }

    const message = value.messages[0]
    const phoneNumber = message.from
    const messageText = message.text?.body

    if (!messageText) {
      console.log('⚠️ No text in message')
      return new NextResponse('OK', { status: 200 })
    }

    console.log(`📱 Message from ${phoneNumber}: ${messageText}`)

    // Get or create conversation
    let conversation: Conversation | null = null
    try {
      const { data: convData, error: convError } = await supabaseServer
        .rpc('get_or_create_conversation', { phone_num: phoneNumber })

      if (convError) {
        console.error('❌ Error getting/creating conversation:', convError)
      } else {
        conversation = convData
        console.log(`✅ Conversation ID: ${conversation}`)
      }
    } catch (error) {
      console.error('❌ Exception in get_or_create_conversation:', error)
    }

    if (!conversation) {
      console.error('❌ Failed to get/create conversation')
      return new NextResponse('Error processing conversation', { status: 500 })
    }

    // Store user message
    try {
      const { error: userMsgError } = await supabaseServer
        .from('messages')
        .insert({
          conversation_id: conversation,
          role: 'user',
          content: messageText,
        })

      if (userMsgError) {
        console.error('❌ Error storing user message:', userMsgError)
      } else {
        console.log('✅ User message stored')
      }
    } catch (error) {
      console.error('❌ Exception storing user message:', error)
    }

    // Categorizar intención y generar respuesta
    const { intent } = await categorizeIntent(messageText)
    console.log(`🎯 Intent detected: ${intent}`)

    let aiResponse = ''

    // PROCESAR SEGÚN INTENCIÓN
    if (intent === 'appointment') {
      aiResponse = await handleAppointmentIntent(phoneNumber, messageText, conversation.id)
    } else {
      // Para otras intenciones, usar RAG
      const { response, confidence, sources } = await generateRAGResponse(messageText)
      console.log(`🤖 RAG Response (confidence: ${confidence}): ${response.substring(0, 100)}...`)

      aiResponse = response

      // Si la confianza es baja, agregar referencia a humano
      if (confidence < 0.5) {
        aiResponse += '\n\n💡 Para más información específica, puedes llamar directamente al +52 551 234 5678.'
      }
    }

    // Store AI response
    try {
      const { error: aiMsgError } = await supabaseServer
        .from('messages')
        .insert({
          conversation_id: conversation,
          role: 'assistant',
          content: aiResponse,
        })

      if (aiMsgError) {
        console.error('❌ Error storing AI message:', aiMsgError)
      } else {
        console.log('✅ AI message stored')
      }
    } catch (error) {
      console.error('❌ Exception storing AI message:', error)
    }

    // Send response back via WhatsApp Cloud API
    try {
      const whatsappUrl = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`

      const response = await fetch(whatsappUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneNumber,
          text: { body: aiResponse },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ WhatsApp API error:', response.status, errorText)
      } else {
        console.log('✅ Response sent to WhatsApp')
      }
    } catch (error) {
      console.error('❌ Exception sending to WhatsApp:', error)
    }

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('❌ Webhook POST error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}

/**
 * Maneja la intención de agendar cita
 */
async function handleAppointmentIntent(
  phoneNumber: string,
  userMessage: string,
  conversationId: string
): Promise<string> {
  const state = conversationStates.get(conversationId) || { status: 'idle' }

  // Extraer información del mensaje usando GPT-4
  const extractInfo = async (msg: string) => {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `Extrae la siguiente información del mensaje del usuario sobre una cita dental:
- Nombre del paciente (si está disponible)
- Servicio deseado (limpieza, consulta, extracción, etc.)
- Fecha deseada (mañana, hoy, fecha específica)
- Hora deseada (si está disponible)

Responde en formato JSON:
{
  "patientName": "nombre o null",
  "serviceName": "servicio o null",
  "date": "fecha o null",
  "time": "hora o null"
}

Si falta información, usa null para ese campo.`,
          },
          { role: 'user', content: msg },
        ],
        max_tokens: 200,
        temperature: 0.3,
      })

      const content = completion.choices[0]?.message?.content || '{}'
      return JSON.parse(content)
    } catch (error) {
      console.error('Error extracting info:', error)
      return { patientName: null, serviceName: null, date: null, time: null }
    }
  }

  // Extraer información del mensaje actual
  const extracted = await extractInfo(userMessage)
  console.log('📝 Extracted info:', JSON.stringify(extracted, null, 2))

  // Actualizar estado con la información actual
  if (extracted.patientName) state.patientName = extracted.patientName
  if (extracted.serviceName) state.serviceName = extracted.serviceName
  if (extracted.date) state.preferredDate = extracted.date
  if (extracted.time) state.preferredTime = extracted.time
  state.status = 'collecting_info'
  conversationStates.set(conversationId, state)

  console.log('📋 Conversation state:', JSON.stringify(state, null, 2))

  // Verificar si tenemos toda la información necesaria
  if (!state.patientName) {
    const { patient } = await getPatientByPhone(phoneNumber)
    if (patient) {
      state.patientName = patient.full_name || 'Paciente'
      console.log('✅ Patient found:', state.patientName)
    }
  }

  if (!state.serviceName || !state.preferredDate) {
    // Pedir información faltante
    let missingInfo = []
    if (!state.patientName) missingInfo.push('tu nombre completo')
    if (!state.serviceName) missingInfo.push('el servicio que necesitas')
    if (!state.preferredDate) missingInfo.push('la fecha y hora preferida')

    return `¡Claro! Te ayudo a agendar tu cita. 📅

Para completar tu cita necesito que me proporciones:
${missingInfo.map(info => `• ${info}`).join('\n')}

Nuestros servicios incluyen: limpieza, consultas, extracciones, blanqueamiento y más.

¿Qué información te gustaría proporcionar primero?`
  }

  // Tenemos toda la información, proceder a crear la cita
  const serviceName = state.serviceName!
  const patientName = state.patientName!

  // Buscar disponibilidad
  let appointmentDate: Date
  if (state.preferredDate?.toLowerCase().includes('mañana')) {
    appointmentDate = new Date()
    appointmentDate.setDate(appointmentDate.getDate() + 1)
  } else if (state.preferredDate?.toLowerCase().includes('hoy')) {
    appointmentDate = new Date()
  } else {
    // Intentar parsear fecha específica
    try {
      appointmentDate = new Date(state.preferredDate!)
    } catch {
      // Si no se puede parsear, usar mañana
      appointmentDate = new Date()
      appointmentDate.setDate(appointmentDate.getDate() + 1)
    }
  }

  // Establecer hora preferida si existe
  if (state.preferredTime) {
    const [hours, minutes] = state.preferredTime.split(':')
    appointmentDate.setHours(parseInt(hours), parseInt(minutes || '0'))
  } else {
    // Usar hora por defecto (10:00 AM)
    appointmentDate.setHours(10, 0, 0, 0)
  }

  console.log(`📅 Attempting appointment for: ${appointmentDate.toISOString()}`)

  // Verificar disponibilidad
  const availability = await checkAvailability(appointmentDate, 45)

  if (!availability.available) {
    // Ofrecer alternativas
    const { slots } = await getAvailableSlots(appointmentDate, 45)

    if (slots && slots.length > 0) {
      let slotsList = slots.slice(0, 3).map((s, i) => {
        const start = new Date(s.start)
        const end = new Date(s.end)
        return `  ${i + 1}. ${start.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
      }).join('\n')

      return `Lo siento, no hay disponibilidad para la fecha que solicitaste. 📅

Sin embargo, tengo los siguientes horarios disponibles para el ${appointmentDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}:

${slotsList}

¿Te gustaría alguno de estos horarios?`
    } else {
      return `Lo siento, no hay disponibilidad para la fecha que solicitaste. 📅

¿Te gustaría agendar para otro día? Puedes decirme "mañana", "próximo martes", etc.`
    }
  }

  // Crear la cita
  console.log('✅ Creating appointment...')
  const result = await createAppointment({
    patient_phone: phoneNumber,
    patient_name: patientName,
    service_name: serviceName,
    appointment_date: appointmentDate,
  })

  if (!result.success) {
    return `❌ Lo siento, ocurrió un error al crear tu cita: ${result.error}

Por favor, intenta nuevamente o contáctanos directamente al +52 551 234 5678.`
  }

  const appointment = result.appointment!
  console.log('✅ Appointment created:', appointment.id)

  // Enviar confirmación por WhatsApp
  console.log('📱 Sending confirmation...')
  const confirmationResult = await sendConfirmation(appointment.id, appointment)

  if (!confirmationResult.success) {
    console.error('❌ Failed to send confirmation:', confirmationResult.error)
    // No fallar, la cita ya está creada
  }

  // Programar recordatorio (24h antes)
  await scheduleReminder(appointment.id, appointment, '24h_before')
  console.log('📅 Reminder scheduled')

  // Limpiar estado de conversación
  conversationStates.delete(conversationId)

  // Generar mensaje de éxito
  const confirmationMsg = formatConfirmationMessage(appointment)

  return `¡Perfecto! Tu cita ha sido agendada. ✅

${confirmationMsg}

¿Necesitas algo más?`
}

/**
 * Formatea el mensaje de confirmación
 */
function formatConfirmationMessage(appointment: any): string {
  const date = new Date(appointment.appointment_date)
  const endDate = new Date(appointment.end_time)

  return `📅 **Fecha:** ${date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
⏰ **Hora:** ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
🦷 **Servicio:** ${appointment.service?.name}
💰 **Precio:** $${appointment.service?.price} MXN`
}
