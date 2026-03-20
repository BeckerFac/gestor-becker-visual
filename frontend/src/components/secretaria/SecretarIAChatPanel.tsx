// SecretarIA — In-app floating chat panel
// Reuses the same backend pipeline as WhatsApp but via HTTP

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useBilling } from '@/hooks/useBilling'

// ── Types ──

interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly timestamp: Date
  readonly intent?: string
  readonly isError?: boolean
}

// ── Quick actions shown when chat is empty ──

const QUICK_ACTIONS = [
  { label: 'Resumen del dia', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { label: 'Quien me debe?', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  { label: 'Stock bajo', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
]

// ── Max message length ──

const MAX_MESSAGE_LENGTH = 2000
const MAX_FILE_SIZE_MB = 10

// ── Component ──

export const SecretarIAChatPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [configChecked, setConfigChecked] = useState(false)
  const [isEnabled, setIsEnabled] = useState(false)
  const [limitReached, setLimitReached] = useState<'daily' | 'monthly' | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messageQueueRef = useRef<string[]>([])
  const processingRef = useRef(false)

  const isModuleEnabled = useAuthStore((s) => s.isModuleEnabled)
  const { hasFeature, loading: billingLoading } = useBilling()

  // Check if secretaria module is available
  useEffect(() => {
    if (!isModuleEnabled('secretaria')) {
      setConfigChecked(true)
      setIsEnabled(false)
      return
    }

    const checkConfig = async () => {
      try {
        const config = await api.getSecretariaConfig()
        setIsEnabled(config.enabled === true)
      } catch {
        setIsEnabled(false)
      } finally {
        setConfigChecked(true)
      }
    }
    checkConfig()
  }, [isModuleEnabled])

  // Load chat history when panel opens for the first time
  useEffect(() => {
    if (!isOpen || historyLoaded) return

    const loadHistory = async () => {
      try {
        const data = await api.secretariaChatHistory(50)
        const historyMessages: ChatMessage[] = (data.messages || []).map((msg: any, idx: number) => ({
          id: `hist_${idx}_${new Date(msg.created_at).getTime()}`,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.created_at),
        }))
        if (historyMessages.length > 0) {
          setMessages(historyMessages)
        }
      } catch {
        // History load failed, start fresh
      } finally {
        setHistoryLoaded(true)
      }
    }
    loadHistory()
  }, [isOpen, historyLoaded])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  // Process message queue sequentially
  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true

    while (messageQueueRef.current.length > 0) {
      const nextMessage = messageQueueRef.current.shift()!
      setLoading(true)

      try {
        const response = await api.secretariaChat(nextMessage)

        // Detect limit responses from backend
        if (response.intent === 'daily_limit_exceeded') {
          setLimitReached('daily')
        } else if (response.intent === 'monthly_limit_exceeded') {
          setLimitReached('monthly')
        }

        const assistantMessage: ChatMessage = {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: response.response,
          timestamp: new Date(),
          intent: response.intent,
        }
        setMessages(prev => [...prev, assistantMessage])
      } catch (error: any) {
        const errorMessage: ChatMessage = {
          id: `error_${Date.now()}`,
          role: 'assistant',
          content: error.message || 'Error al procesar la consulta. Intenta de nuevo.',
          timestamp: new Date(),
          isError: true,
        }
        setMessages(prev => [...prev, errorMessage])
      } finally {
        setLoading(false)
      }
    }

    processingRef.current = false
  }, [])

  const sendMessage = useCallback((messageText?: string) => {
    const text = (messageText || input).trim()
    if (!text || text.length > MAX_MESSAGE_LENGTH) return

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')

    // Queue for processing
    messageQueueRef.current.push(text)
    processQueue()
  }, [input, processQueue])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Don't render if not configured or module not enabled
  if (!configChecked || billingLoading) return null
  if (!isEnabled) return null

  // If plan doesn't include AI chat, show upgrade prompt
  const planHasAiChat = hasFeature('ai_chat')

  if (!planHasAiChat && !isOpen) {
    // Don't show the button at all if plan doesn't have AI
    return null
  }

  if (!planHasAiChat && isOpen) {
    return (
      <>
        <button
          onClick={() => setIsOpen(false)}
          className="fixed bottom-24 right-6 z-[60] w-14 h-14 bg-gradient-to-br from-purple-600 to-violet-700 text-white rounded-full shadow-lg flex items-center justify-center"
          title="SecretarIA"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="fixed bottom-[10.5rem] right-6 z-[60] w-[400px] max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">SecretarIA no disponible</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            El chat IA requiere el plan Premium. Actualiza tu plan para acceder a SecretarIA.
          </p>
          <a
            href="/settings?tab=billing"
            className="inline-block px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Ver planes
          </a>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Floating Button — positioned above the AIChatPanel button (bottom-24) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-24 right-6 z-[60] w-14 h-14 bg-gradient-to-br from-purple-600 to-violet-700 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center"
        title="SecretarIA"
        aria-label="Abrir chat de SecretarIA"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
        {/* Online indicator */}
        {!isOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-950" />
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-[10.5rem] right-6 z-[60] w-[400px] max-w-[calc(100vw-1.5rem)] h-[500px] max-h-[calc(100vh-12rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden sm:w-[400px] max-sm:inset-0 max-sm:fixed max-sm:w-full max-sm:h-full max-sm:max-w-none max-sm:max-h-none max-sm:rounded-none max-sm:bottom-0 max-sm:right-0">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-purple-600 to-violet-700 text-white flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">SecretarIA</h3>
              <p className="text-xs text-white/70">Tu asistente de gestion</p>
            </div>
            {/* Close button (mobile) */}
            <button
              onClick={() => setIsOpen(false)}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              aria-label="Cerrar chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Quick actions when empty */}
            {messages.length === 0 && !loading && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                  Preguntame lo que necesites sobre tu negocio
                </p>
                <div className="space-y-2">
                  {QUICK_ACTIONS.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(action.label)}
                      className="w-full text-left px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-950/30 rounded-lg transition-colors border border-gray-100 dark:border-gray-700 flex items-center gap-3"
                    >
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={action.icon} />
                      </svg>
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white rounded-br-md'
                      : msg.isError
                        ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded-bl-md border border-red-200 dark:border-red-800'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${
                    msg.role === 'user' ? 'text-white/50' : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {msg.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Limit reached banners */}
          {limitReached === 'daily' && (
            <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800 text-center">
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                Limite diario alcanzado. Intenta manana.
              </p>
            </div>
          )}
          {limitReached === 'monthly' && (
            <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-800 text-center">
              <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-1">
                Limite mensual alcanzado.
              </p>
              <a
                href="/settings?tab=billing"
                className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline"
              >
                Comprar creditos
              </a>
            </div>
          )}

          {/* Input Area */}
          <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribi tu consulta..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                disabled={loading}
                maxLength={MAX_MESSAGE_LENGTH}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                title="Enviar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            {input.length > MAX_MESSAGE_LENGTH * 0.9 && (
              <p className="text-[10px] text-gray-400 mt-1 text-right">
                {input.length}/{MAX_MESSAGE_LENGTH}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
