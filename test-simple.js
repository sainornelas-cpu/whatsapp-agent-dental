/**
 * Script de diagnóstico simple sin dependencias externas
 */

import fs from 'fs'
import path from 'path'

// Leer .env.local manualmente
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
  const value = env[envVar]
  if (!value) {
    log('❌', `${envVar}: NO CONFIGURADO`)
    allEnvOk = false
  } else {
    const displayValue = envVar.includes('KEY') || envVar.includes('TOKEN')
      ? `${value.substring(0, 8)}...` : value
    log('✅', `${envVar}: ${displayValue}`)
  }
}

// 2. Verificar archivos necesarios
log('\n📋', '=== VERIFICANDO ARCHIVOS ===')
const files = ['AGENT_PROMPT.md', 'lib/supabase.ts', 'app/api/webhook/route.ts']
for (const file of files) {
  const filePath = path.join(process.cwd(), file)
  if (fs.existsSync(filePath)) {
    log('✅', `${file}: existe`)
  } else {
    log('❌', `${file}: NO existe`)
    allEnvOk = false
  }
}

// 3. Probar conexiones
log('\n📋', '=== PROBANDO CONEXIONES ===')

// Probar Supabase
try {
  const response = await fetch(env.NEXT_PUBLIC_SUPABASE_URL)
  if (response.ok) {
    log('✅', `Supabase URL accesible: ${env.NEXT_PUBLIC_SUPABASE_URL}`)
  } else {
    log('❌', `Supabase URL no responde: ${response.status}`)
  }
} catch (error) {
  log('❌', `Error conectando a Supabase: ${error.message}`)
}

// Probar OpenAI
try {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    }
  })
  if (response.ok) {
    log('✅', 'OpenAI API key válida')
  } else {
    const error = await response.text()
    log('❌', `OpenAI API key inválida (${response.status}): ${error}`)
  }
} catch (error) {
  log('❌', `Error conectando a OpenAI: ${error.message}`)
}

// Probar WhatsApp
try {
  const whatsappUrl = `https://graph.facebook.com/v18.0/${env.WHATSAPP_PHONE_NUMBER_ID}`
  const response = await fetch(whatsappUrl, {
    headers: {
      'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`
    }
  })
  if (response.ok) {
    const data = await response.json()
    log('✅', `WhatsApp API funciona. Número: ${data.display_phone_number || 'Configurado'}`)
  } else {
    const error = await response.text()
    log('❌', `WhatsApp API error (${response.status})`)
    log('⚠️', `Detalle: ${error.substring(0, 200)}`)
  }
} catch (error) {
  log('❌', `Error conectando a WhatsApp: ${error.message}`)
}

// 4. Verificar schema de Supabase
log('\n📋', '=== VERIFICANDO SCHEMA SUPABASE ===')
log('⚠️', 'Para verificar el schema, necesitas ejecutar schema.sql en Supabase')
log('💡', '1. Ve a https://supabase.com/dashboard')
log('💡', '2. Selecciona tu proyecto')
log('💡', '3. Ve a SQL Editor')
log('💡', '4. Ejecuta el contenido de supabase/schema.sql')

// 5. Resumen
log('\n📋', '=== RESUMEN ===')
if (allEnvOk) {
  log('✅', 'Variables de entorno y archivos básicos OK')
} else {
  log('❌', 'Faltan variables o archivos')
}

log('\n📋', '=== PASOS SIGUIENTES ===')
console.log(`
1. EJECUTAR SCHEMA EN SUPABASE:
   - Ve a https://supabase.com/dashboard/project/${env.NEXT_PUBLIC_SUPABASE_URL.split('//')[1].split('.')[0]}/sql/new
   - Ejecuta el contenido de: supabase/schema.sql

2. CREAR USUARIO EN SUPABASE:
   - Ve a Authentication > Users
   - Crea un usuario para el login

3. INICIAR EL SERVIDOR LOCAL:
   npm run dev

4. EXONERAR EL SERVIDOR (para webhook):
   - Instala ngrok: https://ngrok.com/download
   - Ejecuta: ngrok http 3000
   - Copia la URL (ej: https://abc123.ngrok.io)

5. CONFIGURAR WEBHOOK EN META:
   - Ve a Meta Business Suite > WhatsApp > API Setup
   - Webhook URL: https://tu-ngrok-url.com/api/webhook
   - Verify Token: ${env.WHATSAPP_VERIFY_TOKEN}
   - Suscríbete al evento "messages"

6. O DESPLEGAR A VERCEL:
   - Sube el código a GitHub
   - Crea proyecto en Vercel
   - Configura las variables de entorno
   - Configura el webhook con la URL de Vercel
`)
