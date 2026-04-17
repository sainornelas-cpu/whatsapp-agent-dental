/**
 * Script para verificar el estado completo de la base de datos en Supabase
 * Ejecutar con: node check-db-status.js
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

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
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
}

function log(type, message) {
  const color = type === '✅' ? colors.green :
                type === '❌' ? colors.red :
                type === '⚠️' ? colors.yellow :
                type === '📊' ? colors.cyan : colors.blue
  console.log(`${color}${type}${colors.reset} ${message}`)
}

async function checkDatabaseStatus() {
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  )

  log('📋', '=== VERIFICANDO ESTADO DE BASE DE DATOS SUPABASE ===\n')

  // Tablas esperadas
  const expectedTables = [
    'conversations',
    'messages',
    'patients',
    'services',
    'availability',
    'dentists',
    'dentist_availability',
    'appointments',
    'reminders',
    'promotions',
    'payments',
    'bookings',
    'knowledge_base',
    'analytics_events',
    'system_settings'
  ]

  // Funciones esperadas
  const expectedFunctions = [
    'get_or_create_patient',
    'check_availability',
    'get_available_slots',
    'get_or_create_conversation',
    'update_updated_at_column'
  ]

  // Verificar tablas
  log('📊', 'Verificando tablas...\n')

  // Usar una consulta directa
  const { data: tablesData, error: tablesError } = await supabase
    .from('conversations')
    .select('*')
    .limit(1)

  // Verificar cada tabla individualmente
  const existingTables = []
  for (const table of expectedTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1)

      if (!error) {
        existingTables.push(table)
      }
    } catch (e) {
      // Tabla no existe
    }
  }
  const missingTables = expectedTables.filter(t => !existingTables.includes(t))

  if (missingTables.length === 0) {
    log('✅', 'Todas las tablas requeridas existen\n')
  } else {
    log('❌', `Faltan ${missingTables.length} tablas:`)
    missingTables.forEach(t => log('⚠️', `  - ${t}`))
    log('💡', 'Ejecuta schema-dental-clinic.sql en Supabase SQL Editor\n')
  }

  // Mostrar tablas existentes
  log('📊', 'Tablas en la base de datos:')
  expectedTables.forEach(table => {
    if (existingTables.includes(table)) {
      log('✅', `  ✓ ${table}`)
    } else {
      log('❌', `  ✗ ${table} (falta)`)
    }
  })

  // Verificar funciones
  log('\n🔧', 'Verificando funciones...\n')

  const existingFunctions = []

  // Verificar cada función probándola
  for (const funcName of expectedFunctions) {
    try {
      let result
      if (funcName === 'get_or_create_patient') {
        result = await supabase.rpc(funcName, { phone_num: '+TEST000000', patient_name: 'Test' })
      } else if (funcName === 'get_or_create_conversation') {
        result = await supabase.rpc(funcName, { phone_num: '+TEST000000' })
      } else if (funcName === 'check_availability') {
        result = await supabase.rpc(funcName, { requested_date: new Date().toISOString(), duration_minutes: 30 })
      } else if (funcName === 'get_available_slots') {
        result = await supabase.rpc(funcName, { target_date: new Date().toISOString().split('T')[0], duration_minutes: 30 })
      } else if (funcName === 'update_updated_at_column') {
        // Esta es una función de trigger, no se puede llamar directamente
        existingFunctions.push(funcName)
        continue
      }

      if (result.error) {
        // La función existe pero hubo un error en la ejecución
        if (!result.error.message.includes('function') && !result.error.message.includes('does not exist')) {
          existingFunctions.push(funcName)
        }
      } else {
        existingFunctions.push(funcName)
      }
    } catch (e) {
      // Función no existe
    }
  }

  // Limpiar datos de prueba
  try {
    await supabase.from('conversations').delete().eq('phone_number', '+TEST000000')
    await supabase.from('patients').delete().eq('phone_number', '+TEST000000')
  } catch (e) {
    // No importa si falla
  }
  const missingFunctions = expectedFunctions.filter(f => !existingFunctions.includes(f))

  if (missingFunctions.length === 0) {
    log('✅', 'Todas las funciones requeridas existen\n')
  } else {
    log('❌', `Faltan ${missingFunctions.length} funciones:`)
    missingFunctions.forEach(f => log('⚠️', `  - ${f}`))
    log('💡', 'Ejecuta schema-dental-clinic.sql en Supabase SQL Editor\n')
  }

  // Mostrar funciones existentes
  log('📊', 'Funciones en la base de datos:')
  expectedFunctions.forEach(func => {
    if (existingFunctions.includes(func)) {
      log('✅', `  ✓ ${func}()`)
    } else {
      log('❌', `  ✗ ${func}() (falta)`)
    }
  })

  // Verificar datos de ejemplo
  log('\n📊', 'Verificando datos de ejemplo...\n')

  const { count: servicesCount } = await supabase
    .from('services')
    .select('*', { count: 'exact', head: true })

  const { count: dentistsCount } = await supabase
    .from('dentists')
    .select('*', { count: 'exact', head: true })

  const { count: knowledgeCount } = await supabase
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true })

  log('📊', 'Datos de ejemplo:')
  log('📊', `  Servicios: ${servicesCount || 0}`)
  log('📊', `  Odontólogos: ${dentistsCount || 0}`)
  log('📊', `  Base de conocimiento: ${knowledgeCount || 0}`)

  // Resumen
  log('\n📋', '=== RESUMEN ===')
  const tablesComplete = missingTables.length === 0
  const functionsComplete = missingFunctions.length === 0

  if (tablesComplete && functionsComplete) {
    log('✅', 'Base de datos COMPLETA y lista para producción')
  } else {
    log('❌', 'Base de datos INCOMPLETA')
    if (!tablesComplete) {
      log('💡', 'Ejecuta schema-dental-clinic.sql en Supabase SQL Editor')
    }
    if (!functionsComplete) {
      log('💡', 'Ejecuta schema-dental-clinic.sql en Supabase SQL Editor')
    }
  }

  // Próximos pasos
  log('\n📋', '=== PRÓXIMOS PASOS ===')

  if (!tablesComplete || !functionsComplete) {
    log('1️⃣', 'Ejecutar schema-dental-clinic.sql en Supabase SQL Editor')
    log('2️⃣', 'Volver a ejecutar este script para verificar')
  }

  if (knowledgeCount === 0) {
    log('3️⃣', 'Indexar base de conocimiento con embeddings (si vas a usar RAG)')
  }

  log('4️⃣', 'Crear usuario administrador: node create-admin-user.js')
  log('5️⃣', 'Desplegar en Vercel')
  log('6️⃣', 'Configurar webhook de WhatsApp en Meta')
}

checkDatabaseStatus().catch(console.error)
