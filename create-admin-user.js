/**
 * Script para crear usuario administrador en Supabase
 * Ejecutar con: node create-admin-user.js
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Configuración del usuario administrador
const ADMIN_EMAIL = 'admin@clinicadental.com'
const ADMIN_PASSWORD = 'DentalAdmin2024!'

async function createAdminUser() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('🔧 Creando usuario administrador en Supabase...\n')

  try {
    // Intentar crear el usuario
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'admin',
        full_name: 'Administrador'
      }
    })

    if (error) {
      // Si el usuario ya existe, mostrar mensaje
      if (error.message.includes('already been registered')) {
        console.log('⚠️  El usuario administrador ya existe.\n')
        console.log('📧 Email:', ADMIN_EMAIL)
        console.log('🔑 Contraseña:', ADMIN_PASSWORD)
        console.log('\nPuedes usar estas credenciales para iniciar sesión en el dashboard.')
        return
      }
      throw error
    }

    console.log('✅ Usuario administrador creado exitosamente!\n')
    console.log('══════════════════════════════════════════════════════════════')
    console.log('CREDENCIALES DE ACCESO AL DASHBOARD')
    console.log('══════════════════════════════════════════════════════════════')
    console.log(`📧 Email:    ${ADMIN_EMAIL}`)
    console.log(`🔑 Password: ${ADMIN_PASSWORD}`)
    console.log(`🌐 Dashboard: http://localhost:3000/dashboard`)
    console.log('══════════════════════════════════════════════════════════════')
    console.log('\n⚠️  IMPORTANTE: Guarda estas credenciales en un lugar seguro.')
    console.log('⚠️  Cambia la contraseña después del primer inicio de sesión.')

  } catch (error) {
    console.error('❌ Error al crear usuario administrador:', error.message)
    process.exit(1)
  }
}

createAdminUser()
