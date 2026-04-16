import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Leer .env.local
const envPath = path.join(process.cwd(), '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [key, ...valueParts] = line.split('=')
      return [key.trim(), valueParts.join('=').trim()]
    })
)

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

log('📋', '=== TEST DE WHATSAPP Y SUPABASE ===\n')

// 1. Probar WhatsApp API
log('📱', 'Probando WhatsApp API...')
try {
  const whatsappUrl = `https://graph.facebook.com/v18.0/${env.WHATSAPP_PHONE_NUMBER_ID}`
  const response = await fetch(whatsappUrl, {
    headers: {
      'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`
    }
  })

  if (response.ok) {
    const data = await response.json()
    log('✅', `WhatsApp API OK - Número: ${data.display_phone_number}`)
  } else {
    const error = await response.json()
    log('❌', `WhatsApp API Error (${response.status})`)
    log('⚠️', `Mensaje: ${error.error?.message || 'Desconocido'}`)
    if (error.error?.code === 190) {
      log('💡', 'SOLUCIÓN: Genera un NUEVO token en Meta Business Suite > WhatsApp > API Setup')
    }
  }
} catch (error) {
  log('❌', `Error: ${error.message}`)
}

// 2. Probar Supabase con credenciales reales
log('\n🗄️', 'Probando Supabase...')
try {
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Probar función
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    phone_num: '+TEST000000'
  })

  if (error) {
    log('❌', `Error en función: ${error.message}`)
    log('⚠️', 'Ejecuta schema-safe.sql en Supabase SQL Editor')
  } else {
    log('✅', `Supabase OK - Función funciona. ID: ${data}`)

    // Limpiar test
    await supabase.from('conversations').delete().eq('phone_number', '+TEST000000')
  }
} catch (error) {
  log('❌', `Error conectando: ${error.message}`)
}

// 3. Verificar OpenAI
log('\n🤖', 'Probando OpenAI...')
try {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    }
  })
  if (response.ok) {
    log('✅', 'OpenAI API OK')
  } else {
    log('❌', 'OpenAI API Error')
  }
} catch (error) {
  log('❌', `Error: ${error.message}`)
}

log('\n📋', '=== RESUMEN ===')
log('💡', 'Si WhatsApp da error 190: Genera NUEVO token en Meta Business Suite')
log('💡', 'Si Supabase da error: Ejecuta schema-safe.sql en SQL Editor')
