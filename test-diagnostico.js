/**
 * Script de diagnóstico para el agente de WhatsApp
 * Prueba cada componente individualmente
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

config({ path: '.env.local' })

// Colores para consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
}

function log(type, message) {
  const color = type === '✅' ? colors.green :
                type === '❌' ? colors.red :
                type === '⚠️' ? colors.yellow : colors.blue
  console.log(`${color}${type}${colors.reset} ${message}`)
}

// 1. Verificar variables de entorno
log('📋', '=== VERIFICANDO VARIABLES DE ENTORNO ===')
const requiredEnvVars = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
]

let allEnvOk = true
for (const envVar of requiredEnvVars) {
  const value = process.env[envVar]
  if (!value) {
    log('❌', `❌ ${envVar}: NO CONFIGURADO`)
    allEnvOk = false
  } else {
    const displayValue = envVar.includes('KEY') || envVar.includes('TOKEN')
      ? `${value.substring(0, 8)}...` : value
    log('✅', `${envVar}: ${displayValue}`)
  }
}

if (!allEnvOk) {
  log('❌', 'Faltan variables de entorno. Revisa .env.local')
  process.exit(1)
}

// 2. Verificar AGENT_PROMPT.md
log('\n📋', '=== VERIFICANDO AGENT_PROMPT.md ===')
try {
  const promptPath = path.join(__dirname, 'AGENT_PROMPT.md')
  const prompt = fs.readFileSync(promptPath, 'utf-8')
  log('✅', `AGENT_PROMPT.md existe (${prompt.length} caracteres)`)
} catch (error) {
  log('❌', `AGENT_PROMPT.md no encontrado: ${error.message}`)
}

// 3. Probar conexión a Supabase
log('\n📋', '=== PROBANDO CONEXIÓN SUPABASE ===')
try {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Probar función get_or_create_conversation
  const testPhone = '+5491100000000'
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    phone_num: testPhone
  })

  if (error) {
    log('❌', `Error en get_or_create_conversation: ${error.message}`)
    log('⚠️', 'Puede que la función no exista en Supabase. Ejecuta schema.sql')
  } else {
    log('✅', `Función get_or_create_conversation funciona. ID: ${data}`)
  }

  // Verificar tablas
  const { data: tables, error: tablesError } = await supabase
    .from('conversations')
    .select('*')
    .limit(1)

  if (tablesError) {
    log('❌', `Error accediendo a tabla conversations: ${tablesError.message}`)
    log('⚠️', 'Es posible que el schema no esté creado. Ejecuta schema.sql en Supabase')
  } else {
    log('✅', 'Tabla conversations accesible')
    const { count } = await supabase.from('conversations').select('*', { count: 'exact', head: true })
    log('📊', `Conversaciones existentes: ${count || 0}`)
  }

} catch (error) {
  log('❌', `Error conectando a Supabase: ${error.message}`)
}

// 4. Probar OpenAI API
log('\n📋', '=== PROBANDO OPENAI API ===')
try {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo', // Usamos gpt-3.5 para pruebas más rápidas
    messages: [{ role: 'user', content: 'Responde con "OK"' }],
    max_tokens: 10
  })

  const answer = response.choices[0]?.message?.content
  log('✅', `OpenAI API funciona. Respuesta: ${answer}`)
} catch (error) {
  log('❌', `Error en OpenAI API: ${error.message}`)
}

// 5. Probar WhatsApp API
log('\n📋', '=== PROBANDO WHATSAPP CLOUD API ===')
try {
  const whatsappUrl = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`
  const response = await fetch(whatsappUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
    }
  })

  if (!response.ok) {
    const error = await response.text()
    log('❌', `WhatsApp API error (${response.status}): ${error}`)
    log('⚠️', 'El access token podría estar vencido o inválido')
  } else {
    const data = await response.json()
    log('✅', `WhatsApp API funciona. Número: ${data.display_phone_number}`)
  }
} catch (error) {
  log('❌', `Error conectando a WhatsApp API: ${error.message}`)
}

// 6. Simular webhook
log('\n📋', '=== SIMULANDO WEBHOOK POST ===')
const mockWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
        messages: [{
          from: '+5491112345678',
          id: 'msg_test_123',
          timestamp: '1234567890',
          text: { body: 'Hola, esta es una prueba' },
          type: 'text'
        }]
      },
      field: 'messages'
    }]
  }]
}

log('📤', 'Payload simulado:', JSON.stringify(mockWebhookPayload, null, 2))
log('💡', 'Para probar el webhook localmente:')
log('💡', '1. Ejecuta: npm run dev')
log('💡', '2. Usa ngrok para exponer el puerto: ngrok http 3000')
log('💡', '3. Configura el webhook en Meta con la URL de ngrok')

// 7. Checklist de configuración
log('\n📋', '=== CHECKLIST DE CONFIGURACIÓN ===')
const checklist = [
  { done: false, msg: 'Ejecutar schema.sql en Supabase (SQL Editor)' },
  { done: false, msg: 'Crear usuario en Supabase Authentication' },
  { done: false, msg: 'Ejecutar npm install en el proyecto' },
  { done: false, msg: 'Configurar todas las variables en .env.local' },
  { done: false, msg: 'Desplegar a Vercel (o ejecutar localmente con ngrok)' },
  { done: false, msg: 'Configurar webhook en Meta Business Suite' },
  { done: false, msg: 'Verificar webhook en Meta (GET request)' },
  { done: false, msg: 'Suscribir webhook a eventos "messages"' }
]

checklist.forEach((item, i) => {
  log('⬜', `${i + 1}. ${item.msg}`)
})

log('\n✅', '=== DIAGNÓSTICO COMPLETADO ===')
