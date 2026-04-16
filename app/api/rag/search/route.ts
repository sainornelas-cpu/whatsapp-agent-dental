/**
 * Endpoint para búsqueda semántica en la base de conocimiento
 *
 * POST /api/rag/search
 *
 * Body:
 * - query: La consulta del usuario
 * - topK: Número de resultados a retornar (default: 3)
 * - category: Categoría para filtrar (opcional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchKnowledgeBase } from '@/lib/rag'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, topK = 3, category } = body

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: 'Query is required',
        },
        { status: 400 }
      )
    }

    console.log(`🔍 Searching knowledge base for: "${query}"`)

    const results = await searchKnowledgeBase(query, topK, category)

    console.log(`✅ Found ${results.length} results`)

    return NextResponse.json({
      success: true,
      results,
      query,
      count: results.length,
    })
  } catch (error) {
    console.error('❌ Error in /api/rag/search:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
