import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase'
import { generateRAGResponse, categorizeIntent, getOrCreatePatient } from '@/lib/rag'
import fs from 'fs'
import path from 'path'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Load agent prompt from file
function getAgentPrompt(): string {
  try {
    const filePath = path.join(process.cwd(), 'AGENT_PROMPT_DENTAL.md')
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8')
    }
  } catch (error) {
    console.error('Error reading AGENT_PROMPT_DENTAL.md:', error)
  }

  // Fallback to default prompt
  return `Eres un asistente profesional y amigable de una clínica dental llamada "Clínica Dental Sonrisas".

INFORMACIÓN DE LA CLÍNICA:
- Horarios: Lunes a Viernes 9:00 AM - 6:00 PM, Sábados 9:00 AM - 2:00 PM
- Ubicación: Av. Principal #123, Ciudad de México
- Teléfono: +525512345678
- Atienden emergencias el mismo día

SERVICIOS PRINCIPALES:
- Consulta General: $500
- Limpieza Dental: $800
- Blanqueamiento: $3,500
- Ortodoncia (consulta): $1,000
- Endodoncia: $4,000

POLÍTICAS:
- Cancelaciones: Con 24h de anticipación sin costo
- Emergencias: Atendidas el mismo día
- Pagos: Aceptamos efectivo, tarjeta, transferencia y seguros

INSTRUCCIONES:
- Sé siempre amable y profesional
- Si no sabes la respuesta, ofrécete a transferir a un humano
- Si el usuario quiere agendar, guíalo amablemente
- Mantén las respuestas concisas y directas`
}

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

// POST handler - Receive WhatsApp messages with RAG
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
    let conversation: any = null
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

    // Get or create patient
    try {
      const patientId = await getOrCreatePatient(phoneNumber)
      console.log(`✅ Patient ID: ${patientId}`)
    } catch (error) {
      console.error('❌ Error with patient:', error)
    }

    // Categorize intent and generate response
    let aiResponse = ''
    try {
      const { intent } = await categorizeIntent(messageText)
      console.log(`📊 Intent: ${intent}`)

      // Use RAG for most intents, simple logic for appointments
      if (intent === 'appointment') {
        aiResponse = await handleAppointmentIntent(messageText, phoneNumber)
      } else if (intent === 'emergency') {
        aiResponse = `⚠️ Entiendo que tienes una emergencia dental. Por favor, llámanos inmediatamente al **+525512345678** para atención urgente.

Si no puedes llamar, por favor compártenos tu ubicación y te ayudaremos lo antes posible.`
      } else {
        // Use RAG for info, pricing, and general queries
        const { response, sources, confidence } = await generateRAGResponse(messageText)

        // If RAG confidence is too low, fallback to general response
        if (confidence < 0.5) {
          console.log(`⚠️ RAG confidence too low (${confidence.toFixed(2)}), using fallback`)
          aiResponse = await generateGeneralResponse(messageText)
        } else {
          aiResponse = response
          console.log(`✅ RAG response generated (confidence: ${confidence.toFixed(2)})`)
        }
      }

      console.log(`🤖 AI Response: ${aiResponse.substring(0, 100)}...`)
    } catch (error) {
      console.error('❌ Error generating AI response:', error)
      aiResponse = 'Lo siento, ocurrió un error al procesar tu consulta. Por favor intenta más tarde o contáctanos directamente al +525512345678.'
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
 * Handle appointment-related intents
 */
async function handleAppointmentIntent(message: string, phoneNumber: string): Promise<string> {
  const messageLower = message.toLowerCase()

  if (messageLower.includes('cancelar') || messageLower.includes('cancel')) {
    return `Para cancelar una cita, necesito verificar tu identidad. Por favor:

1. Proporciona tu nombre completo
2. Indica la fecha y hora de tu cita que deseas cancelar

Una vez verificada la información, procederemos con la cancelación. Recuerda que las cancelaciones con menos de 24h de anticipación pueden tener un cargo del 50%.`
  }

  if (messageLower.includes('reagendar') || messageLower.includes('cambiar') || messageLower.includes('mover')) {
    return `Para reagendar tu cita, por favor:

1. Proporciona tu nombre completo
2. Indica la fecha y hora actual de tu cita
3. Indica la nueva fecha y hora deseada

Verificaremos la disponibilidad y te confirmaremos el cambio.`
  }

  // Default: help with scheduling
  return `¡Claro! Te ayudo a agendar una cita. 📅

Nuestros horarios son:
- Lunes a Viernes: 9:00 AM - 6:00 PM
- Sábados: 9:00 AM - 2:00 PM

Para agendar, necesito:
1. Tu nombre completo
2. El servicio que necesitas (ej: consulta, limpieza, blanqueamiento)
3. La fecha y hora preferida

Algunos de nuestros servicios:
- Consulta General: $500
- Limpieza Dental: $800
- Blanqueamiento: $3,500
- Ortodoncia (consulta): $1,000

¿Cuándo te gustaría agendar?`
}

/**
 * Generate general response when RAG is not available
 */
async function generateGeneralResponse(message: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: getAgentPrompt() },
        { role: 'user', content: message },
      ],
      max_tokens: 500,
      temperature: 0.7,
    })

    return completion.choices[0]?.message?.content || 'Lo siento, no pude entender tu consulta. ¿Podrías ser más específico o contáctarnos directamente al +525512345678?'
  } catch (error) {
    console.error('Error generating general response:', error)
    return 'Lo siento, ocurrió un error. Por favor, intenta más tarde o contáctanos directamente al +525512345678.'
  }
}
