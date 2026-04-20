import { createClient } from '@supabase/supabase-js'

// Client for server-side operations (uses service role)
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Types
export interface Conversation {
  id: string
  phone_number: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[]
}

// Dental Clinic Types
export interface Patient {
  id: string
  phone_number: string
  full_name: string | null
  email: string | null
  created_at: string
}

export interface Service {
  id: string
  name: string
  name_slug: string
  description: string | null
  category: string
  duration_minutes: number
  price: number
  currency: string
  is_active: boolean
}

export interface Appointment {
  id: string
  patient_id: string
  service_id: string
  dentist_id: string | null
  appointment_date: string
  end_time: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'cancelled_clinic' | 'completed' | 'no_show' | 'rescheduled'
  reason: string | null
  created_at: string
}

export interface Reminder {
  id: string
  appointment_id: string
  reminder_type: 'confirmation' | '24h_before' | '1h_before' | 'custom'
  status: 'pending' | 'sent' | 'failed'
  scheduled_for: string | null
  sent_at: string | null
}
