/**
 * Endpoint para indexar la base de conocimiento en pgvector
 *
 * POST /api/rag/index
 *
 * Este endpoint genera embeddings para todas las entradas de la base
 * de conocimiento que aún no tienen embeddings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { indexKnowledgeBase } from '@/lib/rag'

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Starting knowledge base indexing...')

    const result = await indexKnowledgeBase()

    if (result.success) {
      console.log(`✅ Indexing completed: ${result.indexed}/${result.total} entries`)

      return NextResponse.json({
        success: true,
        indexed: result.indexed,
        total: result.total,
        message: `Successfully indexed ${result.indexed} entries`,
      })
    } else {
      console.error('❌ Indexing failed:', result.error)

      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('❌ Error in /api/rag/index:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}

// GET endpoint para verificar el estado del indexado
export async function GET(request: NextRequest) {
  try {
    const { createClient } = await import('@supabase/supabase-js')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Contar entradas con y sin embeddings
    const [{ count: total }, { count: indexed }] = await Promise.all([
      supabase.from('knowledge_base').select('*', { count: 'exact', head: true }).is('is_active', true),
      supabase.from('knowledge_base').select('*', { count: 'exact', head: true }).is('is_active', true).not('embedding', 'is', null),
    ])

    const notIndexed = (total || 0) - (indexed || 0)
    const percentage = total ? Math.round(((indexed || 0) / total) * 100) : 0

    return NextResponse.json({
      success: true,
      total,
      indexed,
      notIndexed,
      percentage,
    })
  } catch (error) {
    console.error('❌ Error in GET /api/rag/index:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get indexing status',
      },
      { status: 500 }
    )
  }
}
