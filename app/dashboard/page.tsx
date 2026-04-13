'use client'

import { useState, useEffect } from 'react'
import { supabaseClient, Conversation } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import ConversationSidebar from '@/components/ConversationSidebar'
import ChatView from '@/components/ChatView'

export default function DashboardPage() {
  const router = useRouter()
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string>('')

  const handleLogout = async () => {
    await supabaseClient.auth.signOut()
    router.push('/')
  }

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id)
    // Fetch the conversation to get phone number
    supabaseClient
      .from('conversations')
      .select('phone_number')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (data) {
          setSelectedPhoneNumber(data.phone_number)
        }
      })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-surface border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
              <svg
                className="h-6 w-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">WhatsApp Agent Dashboard</h1>
              <p className="text-sm text-gray-400">Monitor your AI conversations</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors duration-200"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <ConversationSidebar
          selectedConversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
        />
        <ChatView
          conversationId={selectedConversationId}
          phoneNumber={selectedPhoneNumber}
        />
      </div>
    </div>
  )
}
