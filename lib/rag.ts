/**
 * RAG (Retrieval-Augmented Generation) System
 * Sistema de búsqueda semántica usando pgvector y OpenAI embeddings
 */

import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Genera embeddings para un texto usando OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small', // Más económico y rápido
      input: text,
    })

    return response.data[0].embedding
  } catch (error) {
    console.error('Error generating embedding:', error)
    throw new Error('Failed to generate embedding')
  }
}

/**
 * Genera embeddings para múltiples textos (batch)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    })

    return response.data.map((item) => item.embedding)
  } catch (error) {
    console.error('Error generating batch embeddings:', error)
    throw new Error('Failed to generate batch embeddings')
  }
}

/**
 * Busca en la base de conocimiento usando búsqueda semántica
 */
export async function searchKnowledgeBase(
  query: string,
  topK: number = 3,
  category?: string
): Promise<{
  question: string
  answer: string
  category: string
  similarity: number
}[]> {
  const { createClient } = await import('@supabase/supabase-js')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Generar embedding para la consulta
  const queryEmbedding = await generateEmbedding(query)

  // Construir la consulta de búsqueda
  let sqlQuery = `
    SELECT
      question,
      answer,
      category,
      1 - (embedding <=> $1::vector) as similarity
    FROM knowledge_base
    WHERE is_active = true
  `

  const params: any[] = [queryEmbedding]

  // Filtrar por categoría si se especifica
  if (category) {
    sqlQuery += ` AND category = $${params.length + 1}`
    params.push(category)
  }

  sqlQuery += `
    ORDER BY embedding <=> $1::vector
    LIMIT $${params.length + 1}
  `

  params.push(topK)

  // Ejecutar la consulta
  const { data, error } = await supabase.rpc('exec_sql', {
    query: sqlQuery,
    params: params,
  })

  if (error) {
    console.error('Error searching knowledge base:', error)
    return []
  }

  return data || []
}

/**
 * Busca información específica con contexto ampliado
 */
export async function searchWithContext(
  query: string,
  maxResults: number = 5
): Promise<{
  results: any[]
  context: string
}> {
  const results = await searchKnowledgeBase(query, maxResults)

  if (results.length === 0) {
    return {
      results: [],
      context: '',
    }
  }

  // Construir contexto concatenando las respuestas
  const context = results
    .map((r, i) => `[${i + 1}] ${r.question}\n${r.answer}`)
    .join('\n\n')

  return {
    results,
    context,
  }
}

/**
 * Genera respuesta usando RAG
 */
export async function generateRAGResponse(
  query: string,
  userMessage?: string
): Promise<{
  response: string
  sources: any[]
  confidence: number
}> {
  // Buscar en base de conocimiento
  const { results, context } = await searchWithContext(query, 5)

  if (results.length === 0) {
    // Si no hay resultados, usar el mensaje original sin contexto
    return {
      response: await generateGenericResponse(userMessage || query),
      sources: [],
      confidence: 0,
    }
  }

  // Construir el prompt con contexto
  const prompt = `Eres un asistente útil de una clínica dental. Usa la siguiente información para responder la pregunta del usuario.

INFORMACIÓN DISPONIBLE:
${context}

PREGUNTA DEL USUARIO:
${query}

INSTRUCCIONES:
- Responde basándote SOLAMENTE en la información proporcionada
- Si la información no es suficiente, indícalo amablemente
- Sé conciso y directo
- Usa un tono profesional y amigable
- Si la respuesta implica un precio, menciónalo claramente
- Si es necesario agendar una cita, ofrécete para ayudarle`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: query },
      ],
      max_tokens: 500,
      temperature: 0.7,
    })

    const response = completion.choices[0]?.message?.content || 'Lo siento, no pude generar una respuesta.'

    // Calcular confianza basado en similitud
    const avgSimilarity = results.reduce((sum, r) => sum + r.similarity, 0) / results.length
    const confidence = Math.min(avgSimilarity, 1)

    return {
      response,
      sources: results,
      confidence,
    }
  } catch (error) {
    console.error('Error generating RAG response:', error)
    return {
      response: 'Lo siento, ocurrió un error al procesar tu consulta.',
      sources: [],
      confidence: 0,
    }
  }
}

/**
 * Genera respuesta genérica cuando no hay contexto
 */
async function generateGenericResponse(message: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de una clínica dental. Tu trabajo es ayudar a los pacientes con sus consultas.

INFORMACIÓN DE LA CLÍNICA:
- Nombre: Clínica Dental Sonrisas
- Horarios: Lunes a Viernes 9am-6pm, Sábados 9am-2pm
- Atienden emergencias el mismo día
- Ofrecen consultas, limpiezas, extracciones, blanqueamiento, ortodoncia, resinas, endodoncia y coronas

Si no puedes responder con esta información, indica amablemente que necesitas más detalles o ofrécete a transferirlo con un humano.`,
        },
        { role: 'user', content: message },
      ],
      max_tokens: 300,
      temperature: 0.7,
    })

    return completion.choices[0]?.message?.content || 'Lo siento, no pude entender tu consulta. ¿Podrías ser más específico?'
  } catch (error) {
    console.error('Error generating generic response:', error)
    return 'Lo siento, ocurrió un error. Por favor, intenta más tarde o contáctanos directamente.'
  }
}

/**
 * Indexa el contenido de la base de conocimiento en pgvector
 */
export async function indexKnowledgeBase() {
  const { createClient } = await import('@supabase/supabase-js')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Obtener todas las entradas sin embeddings
  const { data: entries, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .is('embedding', null)
    .is('is_active', true)
    .limit(100)

  if (error) {
    console.error('Error fetching knowledge base entries:', error)
    return { success: false, error: error.message }
  }

  if (!entries || entries.length === 0) {
    console.log('No entries to index')
    return { success: true, indexed: 0 }
  }

  console.log(`Indexing ${entries.length} entries...`)

  // Generar embeddings para cada entrada
  const texts = entries.map((e: any) => `${e.category}: ${e.question} ${e.answer}`)
  const embeddings = await generateEmbeddings(texts)

  // Actualizar cada entrada con su embedding
  let successCount = 0
  for (let i = 0; i < entries.length; i++) {
    const { error: updateError } = await supabase
      .from('knowledge_base')
      .update({ embedding: embeddings[i] })
      .eq('id', entries[i].id)

    if (!updateError) {
      successCount++
    } else {
      console.error(`Error updating entry ${entries[i].id}:`, updateError)
    }
  }

  console.log(`Successfully indexed ${successCount}/${entries.length} entries`)

  return {
    success: true,
    indexed: successCount,
    total: entries.length,
  }
}

/**
 * Categoriza la intención del usuario
 */
export async function categorizeIntent(message: string): Promise<{
  intent: 'appointment' | 'info' | 'pricing' | 'emergency' | 'general' | 'unknown'
  confidence: number
}> {
  const categories = [
    'agendar cita',
    'cancelar cita',
    'reagendar cita',
    'horarios disponibles',
    'precio',
    'costo',
    'cuánto cuesta',
    'servicios',
    'tratamientos',
    'emergencia',
    'dolor',
    'urgencia',
    'ubicación',
    'dirección',
    'contacto',
  ]

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Categoriza la intención del mensaje en una de estas categorías: appointment, info, pricing, emergency, general, unknown.

appointment: agendar, cancelar, reagendar citas
info: información general, servicios, horarios, ubicación
pricing: precios, costos, cuánto cuesta
emergency: emergencia, dolor, urgencia
general: otra información
unknown: no se puede determinar

Responde SOLO con el nombre de la categoría.`,
        },
        { role: 'user', content: message },
      ],
      max_tokens: 20,
      temperature: 0,
    })

    const intent = completion.choices[0]?.message?.content?.trim() || 'unknown'

    const validIntents = ['appointment', 'info', 'pricing', 'emergency', 'general', 'unknown']
    const normalizedIntent = validIntents.includes(intent) ? intent as any : 'unknown'

    return {
      intent: normalizedIntent,
      confidence: 0.8, // Simplificado, podría mejorarse
    }
  } catch (error) {
    console.error('Error categorizing intent:', error)
    return { intent: 'unknown', confidence: 0 }
  }
}

/**
 * Obtiene o crea un paciente
 */
export async function getOrCreatePatient(
  phoneNumber: string,
  name?: string
): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase.rpc('get_or_create_patient', {
    phone_num: phoneNumber,
    patient_name: name || null,
  })

  if (error) {
    console.error('Error getting/creating patient:', error)
    throw new Error('Failed to get or create patient')
  }

  return data
}
