-- ============================================================================
-- SCHEMA COMPLETO PARA CLÍNICA DENTAL
-- ============================================================================
-- Este script crea todas las tablas necesarias para un sistema de gestión
-- de clínica dental con agendamiento de citas y base de conocimiento RAG.
--
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONES NECESARIAS
-- ============================================================================

-- Habilitar UUID para generar IDs únicos
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Habilitar pgvector para embeddings (RAG)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. TABLAS DEL SISTEMA DE WHATSAPP (EXISTENTES)
-- ============================================================================

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. TABLAS DE LA CLÍNICA DENTAL
-- ============================================================================

-- -------------------------------------------------------------------------
-- 3.1 PACIENTES
-- -------------------------------------------------------------------------
-- Almacena información de los pacientes de la clínica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT UNIQUE NOT NULL,
    full_name TEXT,
    email TEXT,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    address TEXT,
    city TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    medical_history TEXT,
    allergies TEXT,
    blood_type TEXT,
    insurance_provider TEXT,
    insurance_number TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.2 SERVICIOS
-- -------------------------------------------------------------------------
-- Catálogo de servicios ofrecidos por la clínica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    name_slug TEXT UNIQUE NOT NULL, -- Para URLs y búsquedas
    description TEXT,
    category TEXT NOT NULL, -- 'general', 'cosmetic', 'orthodontic', 'surgery', 'emergency'
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'MXN',
    is_active BOOLEAN DEFAULT true,
    requires_consultation BOOLEAN DEFAULT false,
    age_restriction TEXT, -- 'adults_only', 'children_only', 'all_ages'
    preparation_instructions TEXT,
    post_care_instructions TEXT,
    image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.3 DISPONIBILIDAD
-- -------------------------------------------------------------------------
-- Horarios de disponibilidad de la clínica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    -- 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    lunch_start_time TIME, -- Hora de inicio del descanso
    lunch_end_time TIME,   -- Hora de fin del descanso
    is_available BOOLEAN DEFAULT true,
    is_holiday BOOLEAN DEFAULT false,
    holiday_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_times CHECK (end_time > start_time),
    CONSTRAINT valid_lunch CHECK (
        (lunch_start_time IS NULL AND lunch_end_time IS NULL) OR
        (lunch_start_time IS NOT NULL AND lunch_end_time IS NOT NULL AND lunch_end_time > lunch_start_time)
    ),
    CONSTRAINT unique_day_holiday UNIQUE (day_of_week, is_holiday)
);

-- -------------------------------------------------------------------------
-- 3.4 ODONTÓLOGOS
-- -------------------------------------------------------------------------
-- Información de los doctores de la clínica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dentists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone_number TEXT,
    specialization TEXT,
    license_number TEXT,
    bio TEXT,
    photo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    years_of_experience INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.5 DISPONIBILIDAD POR ODONTÓLOGO
-- -------------------------------------------------------------------------
-- Horarios específicos de cada odontólogo
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dentist_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dentist_id UUID NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_dentist_times CHECK (end_time > start_time)
);

-- -------------------------------------------------------------------------
-- 3.6 CITAS
-- -------------------------------------------------------------------------
-- Registro de todas las citas agendadas
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id),
    dentist_id UUID REFERENCES dentists(id) ON DELETE SET NULL,
    appointment_date TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL, -- Calculado como appointment_date + service.duration
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Esperando confirmación
        'confirmed',    -- Confirmada
        'cancelled',    -- Cancelada por paciente
        'cancelled_clinic', -- Cancelada por clínica
        'completed',    -- Completada
        'no_show',      -- Paciente no se presentó
        'rescheduled'   -- Reagendada
    )),
    consultation_type TEXT DEFAULT 'in_person' CHECK (consultation_type IN ('in_person', 'online', 'emergency')),
    reason TEXT,
    symptoms TEXT,
    notes TEXT,
    confirmation_sent_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    CONSTRAINT valid_appointment_times CHECK (end_time > appointment_date)
);

-- -------------------------------------------------------------------------
-- 3.7 RECORDATORIOS
-- -------------------------------------------------------------------------
-- Registro de recordatorios enviados a los pacientes
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    reminder_type TEXT NOT NULL CHECK (reminder_type IN ('confirmation', '24h_before', '1h_before', 'custom')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    message TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.8 PROMOCIONES
-- -------------------------------------------------------------------------
-- Promociones y descuentos especiales
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
    discount_value DECIMAL(10, 2) NOT NULL,
    min_amount DECIMAL(10, 2),
    max_discount DECIMAL(10, 2),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    usage_limit INTEGER,
    used_count INTEGER DEFAULT 0,
    applicable_services TEXT[], -- Array de service IDs
    is_active BOOLEAN DEFAULT true,
    promo_code TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_dates CHECK (valid_until > valid_from),
    CONSTRAINT valid_discount CHECK (
        (discount_type = 'percentage' AND discount_value BETWEEN 0 AND 100) OR
        (discount_type = 'fixed_amount' AND discount_value > 0)
    )
);

-- -------------------------------------------------------------------------
-- 3.9 PAGOS
-- -------------------------------------------------------------------------
-- Registro de pagos de los pacientes
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'transfer', 'insurance')),
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
    transaction_id TEXT,
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.10 RESERVAS (BOOKINGS)
-- -------------------------------------------------------------------------
-- Control de slots de tiempo ocupados
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    dentist_id UUID REFERENCES dentists(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'booked' CHECK (status IN ('booked', 'available', 'blocked')),
    booking_source TEXT DEFAULT 'whatsapp' CHECK (booking_source IN ('whatsapp', 'phone', 'email', 'in_person', 'web')),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_booking_times CHECK (end_time > start_time)
);

-- -------------------------------------------------------------------------
-- 3.11 BASE DE CONOCIMIENTO (RAG)
-- -------------------------------------------------------------------------
-- Información para el sistema de búsqueda semántica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL CHECK (category IN (
        'prices',           -- Precios de servicios
        'services',         -- Descripción de servicios
        'policies',         -- Políticas de la clínica
        'faq',              -- Preguntas frecuentes
        'preparation',      -- Preparación para tratamientos
        'post_care',        -- Cuidados posteriores
        'emergency',        -- Información de emergencias
        'insurance',        -- Información de seguros
        'location',         -- Ubicación y horarios
        'contact'           -- Información de contacto
    )),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    keywords TEXT[],
    embedding vector(1536), -- Para OpenAI embeddings (ada-002 o text-embedding-3-small)
    priority INTEGER DEFAULT 0, -- Mayor prioridad aparece primero
    is_active BOOLEAN DEFAULT true,
    language TEXT DEFAULT 'es',
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_question_language UNIQUE (question, language)
);

-- -------------------------------------------------------------------------
-- 3.12 ESTADÍSTICAS Y ANALÍTICA
-- -------------------------------------------------------------------------
-- Registro de eventos para analítica
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    event_data JSONB,
    user_id TEXT, -- ID del paciente si está disponible
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- 3.13 CONFIGURACIÓN DEL SISTEMA
-- -------------------------------------------------------------------------
-- Parámetros configurables del sistema
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. ÍNDICES PARA MEJORAR RENDIMIENTO
-- ============================================================================

-- Índices para WhatsApp
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Índices para Pacientes
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone_number);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients USING gin(to_tsvector('spanish', full_name));

-- Índices para Servicios
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_services_slug ON services(name_slug);

-- Índices para Disponibilidad
CREATE INDEX IF NOT EXISTS idx_availability_day ON availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_availability_available ON availability(is_available) WHERE is_available = true;

-- Índices para Odontólogos
CREATE INDEX IF NOT EXISTS idx_dentists_active ON dentists(is_active) WHERE is_active = true;

-- Índices para Citas
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_dentist ON appointments(dentist_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments(appointment_date, status);

-- Índices para Recordatorios
CREATE INDEX IF NOT EXISTS idx_reminders_appointment ON reminders(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON reminders(scheduled_for) WHERE status = 'pending';

-- Índices para Promociones
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(is_active, valid_from, valid_until) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(promo_code) WHERE promo_code IS NOT NULL;

-- Índices para Pagos
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);

-- Índices para Bookings
CREATE INDEX IF NOT EXISTS idx_bookings_dentist ON bookings(dentist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_time_range ON bookings(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status) WHERE status = 'booked';

-- Índices para Knowledge Base (RAG)
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge_base(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_base USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- Índices para Analytics
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);

-- ============================================================================
-- 5. FUNCIONES Y PROCEDIMIENTOS
-- ============================================================================

-- -------------------------------------------------------------------------
-- 5.1 Función para obtener o crear paciente
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_or_create_patient(phone_num TEXT, patient_name TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
    patient_id UUID;
BEGIN
    SELECT id INTO patient_id FROM patients WHERE phone_number = phone_num;

    IF patient_id IS NULL THEN
        INSERT INTO patients (phone_number, full_name)
        VALUES (phone_num, patient_name)
        RETURNING id INTO patient_id;
    ELSE
        -- Actualizar nombre si se proporciona y está vacío
        IF patient_name IS NOT NULL AND patient_name != '' THEN
            UPDATE patients
            SET full_name = COALESCE(NULLIF(full_name, ''), patient_name)
            WHERE id = patient_id;
        END IF;
    END IF;

    RETURN patient_id;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- 5.2 Función para verificar disponibilidad
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_availability(
    requested_date TIMESTAMPTZ,
    duration_minutes INTEGER,
    dentist_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    is_available BOOLEAN := false;
    day_of_week INTEGER;
    start_time TIME;
    end_time TIME;
    lunch_start TIME;
    lunch_end TIME;
    booked_count INTEGER;
BEGIN
    -- Obtener día de la semana
    day_of_week := EXTRACT(DOW FROM requested_date);

    -- Verificar disponibilidad general de la clínica
    SELECT start_time, end_time, lunch_start_time, lunch_end_time, is_available
    INTO start_time, end_time, lunch_start, lunch_end, is_available
    FROM availability
    WHERE day_of_week = day_of_week
      AND is_available = true
      AND (is_holiday = false OR is_holiday IS NULL)
    LIMIT 1;

    -- Si no hay disponibilidad configurada o no está disponible, retornar false
    IF is_available IS NULL OR NOT is_available THEN
        RETURN false;
    END IF;

    -- Verificar que el horario solicitado esté dentro del horario disponible
    IF requested_date::time < start_time OR
       (requested_date + (duration_minutes || ' minutes')::interval)::time > end_time THEN
        RETURN false;
    END IF;

    -- Verificar que no sea hora de almuerzo
    IF lunch_start IS NOT NULL AND lunch_end IS NOT NULL THEN
        IF requested_date::time < lunch_end AND
           (requested_date + (duration_minutes || ' minutes')::interval)::time > lunch_start THEN
            RETURN false;
        END IF;
    END IF;

    -- Verificar que no haya citas solapadas
    IF dentist_id IS NOT NULL THEN
        SELECT COUNT(*)
        INTO booked_count
        FROM appointments
        WHERE dentist_id = dentist_id
          AND status NOT IN ('cancelled', 'cancelled_clinic')
          AND (
            (appointment_date <= requested_date AND end_time > requested_date) OR
            (appointment_date >= requested_date AND appointment_date < (requested_date + (duration_minutes || ' minutes')::interval)) OR
            (appointment_date < requested_date AND end_time > (requested_date + (duration_minutes || ' minutes')::interval))
          );
    ELSE
        -- Verificar cualquier odontólogo disponible
        SELECT COUNT(DISTINCT dentist_id)
        INTO booked_count
        FROM appointments
        WHERE status NOT IN ('cancelled', 'cancelled_clinic')
          AND (
            (appointment_date <= requested_date AND end_time > requested_date) OR
            (appointment_date >= requested_date AND appointment_date < (requested_date + (duration_minutes || ' minutes')::interval)) OR
            (appointment_date < requested_date AND end_time > (requested_date + (duration_minutes || ' minutes')::interval))
          );

        -- Si hay menos citas que odontólogos activos, hay disponibilidad
        SELECT COUNT(*) INTO is_available
        FROM dentists
        WHERE is_active = true;

        RETURN booked_count < is_available;
    END IF;

    RETURN booked_count = 0;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- 5.3 Función para obtener horarios disponibles
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_available_slots(
    target_date DATE,
    duration_minutes INTEGER DEFAULT 30,
    dentist_id_param UUID DEFAULT NULL
)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, dentist_uuid UUID) AS $$
DECLARE
    clinic_start TIME;
    clinic_end TIME;
    total_minutes INTEGER;
    start_minute INTEGER;
    slot_timestamp TIMESTAMPTZ;
    slot_end_timestamp TIMESTAMPTZ;
BEGIN
    -- Obtener horarios de la clínica
    SELECT start_time, end_time
    INTO clinic_start, clinic_end
    FROM availability
    WHERE day_of_week = EXTRACT(DOW FROM target_date)
      AND is_available = true
      AND (is_holiday = false OR is_holiday IS NULL)
    LIMIT 1;

    -- Si no hay horarios configurados, retornar vacío
    IF clinic_start IS NULL THEN
        RETURN;
    END IF;

    -- Calcular total de minutos operativos
    total_minutes := EXTRACT(EPOCH FROM (clinic_end - clinic_start))::INTEGER / 60;

    -- Generar slots disponibles
    FOR start_minute IN 0..total_minutes - duration_minutes LOOP
        slot_timestamp := target_date + clinic_start + (start_minute || ' minutes')::interval;
        slot_end_timestamp := slot_timestamp + (duration_minutes || ' minutes')::interval;

        -- Para cada dentólogo disponible
        FOR dentist_uuid IN
            SELECT id FROM dentists
            WHERE is_active = true
            AND (dentist_id_param IS NULL OR id = dentist_id_param)
        LOOP
            -- Verificar que no haya conflicto con citas existentes
            IF NOT EXISTS (
                SELECT 1 FROM appointments
                WHERE dentist_id = dentist_uuid
                AND status NOT IN ('cancelled', 'cancelled_clinic')
                AND appointment_date < slot_end_timestamp
                AND end_time > slot_timestamp
            ) THEN
                -- Retornar este slot disponible
                RETURN QUERY SELECT slot_timestamp, slot_end_timestamp, dentist_uuid;
            END IF;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- 5.4 Función para obtener o crear conversación
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_or_create_conversation(phone_num TEXT)
RETURNS UUID AS $$
DECLARE
    conv_id UUID;
BEGIN
    SELECT id INTO conv_id FROM conversations WHERE phone_number = phone_num;

    IF conv_id IS NULL THEN
        INSERT INTO conversations (phone_number) VALUES (phone_num)
        RETURNING id INTO conv_id;
    END IF;

    RETURN conv_id;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- 5.5 Trigger para actualizar updated_at
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a las tablas que tienen updated_at
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
CREATE TRIGGER update_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_services_updated_at ON services;
CREATE TRIGGER update_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_availability_updated_at ON availability;
CREATE TRIGGER update_availability_updated_at
    BEFORE UPDATE ON availability
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dentists_updated_at ON dentists;
CREATE TRIGGER update_dentists_updated_at
    BEFORE UPDATE ON dentists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dentist_availability_updated_at ON dentist_availability;
CREATE TRIGGER update_dentist_availability_updated_at
    BEFORE UPDATE ON dentist_availability
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_promotions_updated_at ON promotions;
CREATE TRIGGER update_promotions_updated_at
    BEFORE UPDATE ON promotions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_knowledge_base_updated_at ON knowledge_base;
CREATE TRIGGER update_knowledge_base_updated_at
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. POLÍTICAS DE SEGURIDAD (RLS)
-- ============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE IF EXISTS conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS services ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dentists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dentist_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analytics_events ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 6.1 Políticas para Service Role (acceso completo desde el servidor)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role all access conversations" ON conversations;
CREATE POLICY "Service role all access conversations" ON conversations
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access messages" ON messages;
CREATE POLICY "Service role all access messages" ON messages
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access patients" ON patients;
CREATE POLICY "Service role all access patients" ON patients
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access services" ON services;
CREATE POLICY "Service role all access services" ON services
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access availability" ON availability;
CREATE POLICY "Service role all access availability" ON availability
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access dentists" ON dentists;
CREATE POLICY "Service role all access dentists" ON dentists
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access dentist_availability" ON dentist_availability;
CREATE POLICY "Service role all access dentist_availability" ON dentist_availability
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access appointments" ON appointments;
CREATE POLICY "Service role all access appointments" ON appointments
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access reminders" ON reminders;
CREATE POLICY "Service role all access reminders" ON reminders
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access promotions" ON promotions;
CREATE POLICY "Service role all access promotions" ON promotions
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access payments" ON payments;
CREATE POLICY "Service role all access payments" ON payments
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access bookings" ON bookings;
CREATE POLICY "Service role all access bookings" ON bookings
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access knowledge_base" ON knowledge_base;
CREATE POLICY "Service role all access knowledge_base" ON knowledge_base
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all access analytics_events" ON analytics_events;
CREATE POLICY "Service role all access analytics_events" ON analytics_events
    FOR ALL USING (auth.role() = 'service_role');

-- -------------------------------------------------------------------------
-- 6.2 Políticas para usuarios autenticados (lectura y escritura limitada)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read conversations" ON conversations;
CREATE POLICY "Authenticated users can read conversations" ON conversations
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read messages" ON messages;
CREATE POLICY "Authenticated users can read messages" ON messages
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read services" ON services;
CREATE POLICY "Authenticated users can read services" ON services
    FOR SELECT USING ((auth.role() = 'authenticated') AND is_active = true);

DROP POLICY IF EXISTS "Authenticated users can read availability" ON availability;
CREATE POLICY "Authenticated users can read availability" ON availability
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read dentists" ON dentists;
CREATE POLICY "Authenticated users can read dentists" ON dentists
    FOR SELECT USING ((auth.role() = 'authenticated') AND is_active = true);

DROP POLICY IF EXISTS "Authenticated users can read knowledge_base" ON knowledge_base;
CREATE POLICY "Authenticated users can read knowledge_base" ON knowledge_base
    FOR SELECT USING ((auth.role() = 'authenticated') AND is_active = true);

-- ============================================================================
-- 7. ENABLE REALTIME
-- ============================================================================

DO $$
BEGIN
    -- Habilitar realtime en tablas principales
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'appointments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'patients'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE patients;
    END IF;
END $$;

-- ============================================================================
-- 8. DATOS DE EJEMPLO (opcional)
-- ============================================================================

-- -------------------------------------------------------------------------
-- 8.1 Servicios de ejemplo
-- -------------------------------------------------------------------------
INSERT INTO services (name, name_slug, description, category, duration_minutes, price, sort_order) VALUES
    ('Consulta General', 'consulta-general', 'Evaluación general de salud dental', 'general', 30, 500.00, 1),
    ('Limpieza Dental', 'limpieza-dental', 'Limpieza profunda y profilaxis', 'general', 45, 800.00, 2),
    ('Extracción de Muela', 'extraccion-muela', 'Extracción simple de muela', 'surgery', 60, 1500.00, 3),
    ('Blanqueamiento', 'blanqueamiento', 'Blanqueamiento dental profesional', 'cosmetic', 90, 3500.00, 4),
    ('Ortodoncia Consulta', 'ortodoncia-consulta', 'Evaluación para tratamiento de ortodoncia', 'orthodontic', 60, 1000.00, 5),
    ('Resina Dental', 'resina-dental', 'Restauración con resina estética', 'general', 60, 1200.00, 6),
    ('Endodoncia', 'endodoncia', 'Tratamiento de conducto', 'surgery', 120, 4000.00, 7),
    ('Corona Dental', 'corona-dental', 'Colocación de corona dental', 'cosmetic', 90, 5000.00, 8)
ON CONFLICT (name_slug) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8.2 Horarios de ejemplo (Lunes a Viernes, 9am - 6pm)
-- -------------------------------------------------------------------------
INSERT INTO availability (day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_holiday) VALUES
    (1, '09:00:00', '18:00:00', '14:00:00', '15:00:00', false), -- Lunes
    (2, '09:00:00', '18:00:00', '14:00:00', '15:00:00', false), -- Martes
    (3, '09:00:00', '18:00:00', '14:00:00', '15:00:00', false), -- Miércoles
    (4, '09:00:00', '18:00:00', '14:00:00', '15:00:00', false), -- Jueves
    (5, '09:00:00', '18:00:00', '14:00:00', '15:00:00', false), -- Viernes
    (6, '09:00:00', '14:00:00', NULL, NULL, false)               -- Sábado (sin almuerzo)
ON CONFLICT (day_of_week, is_holiday) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8.3 Odontólogo de ejemplo
-- -------------------------------------------------------------------------
INSERT INTO dentists (full_name, email, phone_number, specialization, is_active, years_of_experience) VALUES
    ('Dra. María González', 'maria@clinicadental.com', '+525512345678', 'General', true, 10),
    ('Dr. Carlos Rodríguez', 'carlos@clinicadental.com', '+525598765432', 'Ortodoncia', true, 8)
ON CONFLICT (email) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8.4 Configuración del sistema
-- -------------------------------------------------------------------------
INSERT INTO system_settings (key, value, value_type, description) VALUES
    ('clinic_name', 'Clínica Dental Sonrisas', 'string', 'Nombre de la clínica'),
    ('clinic_phone', '+525512345678', 'string', 'Teléfono de contacto'),
    ('clinic_email', 'contacto@clinicadental.com', 'string', 'Email de contacto'),
    ('clinic_address', 'Av. Principal #123, Ciudad de México', 'string', 'Dirección física'),
    ('appointment_confirmation_hours', '24', 'number', 'Horas antes para enviar confirmación'),
    ('appointment_reminder_hours', '2', 'number', 'Horas antes para enviar recordatorio'),
    ('currency', 'MXN', 'string', 'Moneda predeterminada'),
    ('timezone', 'America/Mexico_City', 'string', 'Zona horaria de la clínica')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8.5 Base de conocimiento de ejemplo
-- -------------------------------------------------------------------------
INSERT INTO knowledge_base (category, question, answer, keywords, priority) VALUES
    ('prices', '¿Cuánto cuesta una limpieza dental?', 'La limpieza dental tiene un costo de $800 MXN e incluye una revisión general y recomendaciones de cuidado.', ARRAY['limpieza', 'precio', 'costo', 'cuánto'], 10),
    ('services', '¿Qué servicios ofrecen?', 'Ofrecemos consultas generales, limpiezas, extracciones, blanqueamiento, ortodoncia, resinas, endodoncia y coronas dentales.', ARRAY['servicios', 'tratamientos', 'ofrecen'], 10),
    ('policies', '¿Cuál es su política de cancelación?', 'Puedes cancelar o reagendar tu cita con al menos 24 horas de anticipación sin costo. Cancelaciones tardías pueden tener un cargo del 50%.', ARRAY['cancelar', 'política', 'reagendar'], 8),
    ('emergency', '¿Atienden emergencias?', 'Sí, atendemos emergencias dentales el mismo día. Llámanos directamente al +525512345678 para atención inmediata.', ARRAY['emergencia', 'urgencia', 'dolor'], 10),
    ('insurance', '¿Aceptan seguro dental?', 'Aceptamos la mayoría de los seguros dentales principales. Contactanos para verificar tu cobertura específica.', ARRAY['seguro', 'cobertura', 'aceptan'], 7),
    ('preparation', '¿Necesito preparación para una limpieza?', 'Para una limpieza dental no necesitas preparación especial. Solo llega unos minutos antes de tu hora.', ARRAY['preparación', 'limpieza', 'antes'], 5),
    ('location', '¿Dónde están ubicados?', 'Estamos ubicados en Av. Principal #123, Ciudad de México. Nuestro horario es de lunes a viernes de 9am a 6pm y sábados de 9am a 2pm.', ARRAY['ubicación', 'dónde', 'dirección', 'horario'], 10)
ON CONFLICT (question, language) DO NOTHING;

-- ============================================================================
-- 9. VERIFICACIÓN DE INSTALACIÓN
-- ============================================================================

DO $$
DECLARE
    table_count INTEGER;
    function_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT tablename)
    INTO table_count
    FROM pg_tables
    WHERE schemaname = 'public';

    SELECT COUNT(DISTINCT proname)
    INTO function_count
    FROM pg_proc
    WHERE pronamespace = 'pg_catalog'::regnamespace
      AND proname IN ('get_or_create_patient', 'check_availability', 'get_available_slots', 'get_or_create_conversation', 'update_updated_at_column');

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'INSTALACIÓN DEL SCHEMA COMPLETADA';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Tablas creadas: %', table_count;
    RAISE NOTICE 'Funciones creadas: %', function_count;
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Tablas principales:';
    RAISE NOTICE '  - conversations, messages (WhatsApp)';
    RAISE NOTICE '  - patients (Pacientes)';
    RAISE NOTICE '  - services (Servicios)';
    RAISE NOTICE '  - availability (Disponibilidad)';
    RAISE NOTICE '  - dentists, dentist_availability (Odontólogos)';
    RAISE NOTICE '  - appointments (Citas)';
    RAISE NOTICE '  - reminders (Recordatorios)';
    RAISE NOTICE '  - promotions (Promociones)';
    RAISE NOTICE '  - payments (Pagos)';
    RAISE NOTICE '  - bookings (Reservas)';
    RAISE NOTICE '  - knowledge_base (Base de conocimiento RAG)';
    RAISE NOTICE '  - analytics_events (Analítica)';
    RAISE NOTICE '  - system_settings (Configuración)';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Funciones disponibles:';
    RAISE NOTICE '  - get_or_create_patient(phone, name)';
    RAISE NOTICE '  - check_availability(date, duration, dentist_id)';
    RAISE NOTICE '  - get_available_slots(date, duration, dentist_id)';
    RAISE NOTICE '  - get_or_create_conversation(phone)';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '¡LISTO PARA USAR!';
    RAISE NOTICE '================================================================';
END $$;
