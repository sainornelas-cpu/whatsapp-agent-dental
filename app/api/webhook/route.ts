import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseServer, Conversation, Message } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Load agent prompt from file
function getAgentPrompt(): string {
  try {
    const filePath = path.join(process.cwd(), 'AGENT_PROMPT.md')
    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error('Error reading AGENT_PROMPT.md:', error)
    return 'You are a helpful customer support assistant.'
  }
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

    // Get AI response from OpenAI
    let aiResponse = ''
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: getAgentPrompt() },
          { role: 'user', content: messageText },
        ],
        max_tokens: 500,
        temperature: 0.7,
      })

      aiResponse = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.'
      console.log(`🤖 AI Response: ${aiResponse}`)
    } catch (error) {
      console.error('❌ Error getting AI response:', error)
      aiResponse = 'Sorry, I encountered an error processing your request.'
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
