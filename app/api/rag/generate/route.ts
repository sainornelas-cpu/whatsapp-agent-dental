/**
 * Endpoint para generar respuestas usando RAG
 *
 * POST /api/rag/generate
 *
 * Body:
 * - query: La consulta del usuario
 * - message: El mensaje completo del usuario (opcional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateRAGResponse, categorizeIntent } from '@/lib/rag'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, message } = body

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: 'Query is required',
        },
        { status: 400 }
      )
    }

    console.log(`🤖 Generating RAG response for: "${query}"`)

    // Categorizar la intención
    const { intent } = await categorizeIntent(query)
    console.log(`📊 Intent detected: ${intent}`)

    // Generar respuesta RAG
    const { response, sources, confidence } = await generateRAGResponse(query, message)

    console.log(`✅ Response generated (confidence: ${confidence.toFixed(2)})`)

    return NextResponse.json({
      success: true,
      response,
      sources,
      confidence,
      intent,
    })
  } catch (error) {
    console.error('❌ Error in /api/rag/generate:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
