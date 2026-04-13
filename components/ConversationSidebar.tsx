'use client'

import { useEffect, useState } from 'react'
import { supabaseClient, Conversation } from '@/lib/supabaseClient'

interface ConversationSidebarProps {
  selectedConversationId: string | null
  onSelectConversation: (id: string) => void
}

export default function ConversationSidebar({
  selectedConversationId,
  onSelectConversation,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConversations()

    // Subscribe to new conversations
    const channel = supabaseClient
      .channel('conversations-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          fetchConversations()
        }
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [])

  const fetchConversations = async () => {
    const { data, error } = await supabaseClient
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Error fetching conversations:', error)
    } else {
      setConversations(data || [])
    }
    setLoading(false)
  }

  const formatPhoneNumber = (phone: string) => {
    if (phone.length >= 10) {
      return phone.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3-$4')
    }
    return phone
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="w-80 bg-surface border-r border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-xl font-bold text-white">Conversations</h2>
        <p className="text-sm text-gray-400 mt-1">
          {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-gray-400 text-center">Loading conversations...</div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-gray-400 text-center">No conversations yet</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full p-4 text-left transition-colors duration-200 ${
                  selectedConversationId === conv.id
                    ? 'bg-accent/20 border-l-4 border-accent'
                    : 'hover:bg-gray-800/50 border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">
                      {formatPhoneNumber(conv.phone_number)}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      {formatDate(conv.updated_at)}
                    </p>
                  </div>
                  <div className="ml-3 flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center">
                      <svg
                        className="h-6 w-6 text-accent"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
