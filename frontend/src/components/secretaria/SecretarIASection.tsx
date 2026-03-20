import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FeatureGate } from '@/components/shared/FeatureGate'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SecretariaConfig {
  enabled: boolean
  morning_brief_enabled: boolean
  morning_brief_time: string
  morning_brief_sections: {
    ventas: boolean
    pedidos: boolean
    cobros: boolean
    stock: boolean
    cheques: boolean
    pipeline: boolean
  }
}

interface LinkedPhone {
  id: string
  phone_number: string
  linked_at: string
  status: string
}

interface LinkingCodeResponse {
  code: string
  expires_at: string
  secretaria_number: string
}

interface UsageData {
  messages_sent: number
  messages_received: number
  voice_minutes: number
  estimated_cost_ars: number
  plan_limit_messages: number
  period: string
}

interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  timestamp: string
  message_type: 'text' | 'voice' | 'image'
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

const BRIEF_SECTION_LABELS: Record<string, string> = {
  ventas: 'Ventas del dia anterior',
  pedidos: 'Pedidos pendientes',
  cobros: 'Cobros por vencer',
  stock: 'Alertas de stock bajo',
  cheques: 'Cheques a depositar',
  pipeline: 'Pipeline CRM',
}

const DEFAULT_CONFIG: SecretariaConfig = {
  enabled: false,
  morning_brief_enabled: false,
  morning_brief_time: '08:00',
  morning_brief_sections: {
    ventas: true,
    pedidos: true,
    cobros: true,
    stock: true,
    cheques: false,
    pipeline: false,
  },
}

// ─── Phone Linking ──────────────────────────────────────────────────────────

const PhoneLinkingArea: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [linkingCode, setLinkingCode] = useState<LinkingCodeResponse | null>(null)
  const [generating, setGenerating] = useState(false)
  const [linkedPhones, setLinkedPhones] = useState<LinkedPhone[]>([])
  const [loadingPhones, setLoadingPhones] = useState(true)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLinkedPhones = useCallback(async () => {
    try {
      setLoadingPhones(true)
      const data = await api.getLinkedPhones()
      setLinkedPhones(Array.isArray(data) ? data : data.phones || [])
    } catch {
      // silent — show empty
      setLinkedPhones([])
    } finally {
      setLoadingPhones(false)
    }
  }, [])

  useEffect(() => {
    loadLinkedPhones()
  }, [loadLinkedPhones])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleGenerateCode = async () => {
    if (!phoneNumber.trim()) {
      toast.error('Ingresa un numero de telefono')
      return
    }
    setGenerating(true)
    try {
      const data = await api.generateLinkingCode(phoneNumber.trim())
      setLinkingCode(data)
      // Start 10 min countdown
      const expiresAt = new Date(data.expires_at).getTime()
      const updateCountdown = () => {
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
        setCountdown(remaining)
        if (remaining <= 0 && timerRef.current) {
          clearInterval(timerRef.current)
          setLinkingCode(null)
        }
      }
      updateCountdown()
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(updateCountdown, 1000)
    } catch (e: any) {
      toast.error(e.message || 'Error al generar codigo')
    } finally {
      setGenerating(false)
    }
  }

  const handleUnlink = async (id: string) => {
    try {
      await api.unlinkPhone(id)
      toast.success('Telefono desvinculado')
      await loadLinkedPhones()
    } catch (e: any) {
      toast.error(e.message || 'Error al desvincular')
    }
  }

  const formatCountdown = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatPhoneInput = (value: string): string => {
    // Allow digits, +, spaces, hyphens
    return value.replace(/[^0-9+\-\s]/g, '')
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vincular WhatsApp</h4>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          label="Numero de telefono"
          placeholder="+54 9 11 1234-5678"
          value={phoneNumber}
          onChange={e => setPhoneNumber(formatPhoneInput(e.target.value))}
          className="flex-1"
        />
        <div className="flex items-end">
          <Button
            variant="primary"
            onClick={handleGenerateCode}
            loading={generating}
            disabled={!phoneNumber.trim()}
          >
            Generar codigo
          </Button>
        </div>
      </div>

      {/* Linking code display */}
      {linkingCode && countdown > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 space-y-3">
          <div className="text-center">
            <p className="text-sm text-purple-700 dark:text-purple-300 mb-2">Tu codigo de vinculacion:</p>
            <div className="text-4xl font-mono font-bold tracking-[0.3em] text-purple-800 dark:text-purple-200">
              {linkingCode.code}
            </div>
            <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
              Expira en {formatCountdown(countdown)}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
            <p className="font-medium text-gray-700 dark:text-gray-300">Instrucciones:</p>
            <ol className="list-decimal list-inside text-gray-600 dark:text-gray-400 space-y-1">
              <li>Abri WhatsApp y busca el numero <strong className="text-purple-700 dark:text-purple-300">{linkingCode.secretaria_number}</strong></li>
              <li>Envia este codigo: <strong className="text-purple-700 dark:text-purple-300">{linkingCode.code}</strong></li>
              <li>SecretarIA va a confirmar la vinculacion</li>
            </ol>
          </div>
        </div>
      )}

      {/* Linked phones list */}
      {loadingPhones ? (
        <div className="animate-pulse h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      ) : linkedPhones.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          Vincula tu WhatsApp para empezar
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Telefonos vinculados</p>
          {linkedPhones.map(phone => (
            <div key={phone.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{phone.phone_number}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Vinculado {new Date(phone.linked_at).toLocaleDateString('es-AR')}
                </p>
              </div>
              <Button variant="secondary" onClick={() => handleUnlink(phone.id)}>
                Desvincular
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Morning Brief Config ───────────────────────────────────────────────────

interface MorningBriefConfigProps {
  config: SecretariaConfig
  onUpdate: (config: Partial<SecretariaConfig>) => Promise<void>
}

const MorningBriefConfig: React.FC<MorningBriefConfigProps> = ({ config, onUpdate }) => {
  const [sendingBrief, setSendingBrief] = useState(false)

  const handleSendBrief = async () => {
    setSendingBrief(true)
    try {
      await api.sendBriefNow()
      toast.success('Brief enviado a tu WhatsApp')
    } catch (e: any) {
      toast.error(e.message || 'Error al enviar brief')
    } finally {
      setSendingBrief(false)
    }
  }

  const toggleSection = async (section: keyof SecretariaConfig['morning_brief_sections']) => {
    const updatedSections = {
      ...config.morning_brief_sections,
      [section]: !config.morning_brief_sections[section],
    }
    await onUpdate({ morning_brief_sections: updatedSections })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Resumen matutino</h4>
        <button
          onClick={() => onUpdate({ morning_brief_enabled: !config.morning_brief_enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
            config.morning_brief_enabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.morning_brief_enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {config.morning_brief_enabled && (
        <div className="space-y-3 pl-1">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400">Hora del brief:</label>
            <input
              type="time"
              value={config.morning_brief_time}
              onChange={e => onUpdate({ morning_brief_time: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            />
          </div>

          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Secciones a incluir:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(BRIEF_SECTION_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.morning_brief_sections[key as keyof SecretariaConfig['morning_brief_sections']] ?? false}
                    onChange={() => toggleSection(key as keyof SecretariaConfig['morning_brief_sections'])}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <Button variant="secondary" onClick={handleSendBrief} loading={sendingBrief}>
            Enviar brief ahora
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Usage Dashboard ────────────────────────────────────────────────────────

const UsageDashboard: React.FC = () => {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.getSecretariaUsage()
      .then(data => { if (!cancelled) setUsage(data) })
      .catch(() => {
        // Show zeros for new/empty data
        if (!cancelled) setUsage({
          messages_sent: 0,
          messages_received: 0,
          voice_minutes: 0,
          estimated_cost_ars: 0,
          plan_limit_messages: 500,
          period: new Date().toISOString().slice(0, 7),
        })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="animate-pulse h-20 bg-gray-200 dark:bg-gray-700 rounded" />
  }

  if (!usage) return null

  const totalMessages = usage.messages_sent + usage.messages_received
  const usagePercent = usage.plan_limit_messages > 0
    ? Math.min(100, Math.round((totalMessages / usage.plan_limit_messages) * 100))
    : 0

  const barColor = usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-purple-500'

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Uso este mes</h4>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{usage.messages_sent}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Enviados</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{usage.messages_received}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Recibidos</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{usage.voice_minutes}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Min. voz</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            ${(usage.estimated_cost_ars ?? 0).toLocaleString('es-AR')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Costo est.</p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>Tu plan incluye {usage.plan_limit_messages} mensajes/mes</span>
          <span>Usaste {totalMessages} ({usagePercent}%)</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
          <div
            className={`${barColor} h-2.5 rounded-full transition-all duration-300`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Conversation History ───────────────────────────────────────────────────

const ConversationHistory: React.FC = () => {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const loadMessages = useCallback(async (offset = 0) => {
    const isInitial = offset === 0
    if (isInitial) setLoading(true)
    else setLoadingMore(true)

    try {
      const data = await api.getSecretariaConversations(20, offset)
      const newMessages: ConversationMessage[] = Array.isArray(data) ? data : data.messages || []
      if (isInitial) {
        setMessages(newMessages)
      } else {
        setMessages(prev => [...prev, ...newMessages])
      }
      setHasMore(newMessages.length >= 20)
    } catch {
      if (isInitial) setMessages([])
    } finally {
      if (isInitial) setLoading(false)
      else setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  if (loading) {
    return <div className="animate-pulse space-y-2">
      {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded" />)}
    </div>
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="mx-auto w-12 h-12 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Aun no hay conversaciones. Vincula tu WhatsApp para empezar.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Historial de conversaciones</h4>

      <div className="max-h-96 overflow-y-auto space-y-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
        {messages.map(msg => {
          const isUser = msg.direction === 'inbound'
          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  isUser
                    ? 'bg-purple-600 text-white rounded-br-md'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-bl-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                <p className={`text-xs mt-1 ${isUser ? 'text-purple-200' : 'text-gray-400 dark:text-gray-500'}`}>
                  {new Date(msg.timestamp).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                  {msg.message_type === 'voice' && ' (voz)'}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {hasMore && (
        <div className="text-center">
          <Button
            variant="secondary"
            onClick={() => loadMessages(messages.length)}
            loading={loadingMore}
          >
            Ver mas
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main Section ───────────────────────────────────────────────────────────

export const SecretarIASection: React.FC = () => {
  const [config, setConfig] = useState<SecretariaConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getSecretariaConfig()
      setConfig({
        ...DEFAULT_CONFIG,
        ...data,
        morning_brief_sections: {
          ...DEFAULT_CONFIG.morning_brief_sections,
          ...(data.morning_brief_sections || {}),
        },
      })
    } catch {
      // Config not created yet — use defaults
      setConfig(DEFAULT_CONFIG)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleUpdateConfig = async (partial: Partial<SecretariaConfig>) => {
    const updated = {
      ...config,
      ...partial,
      morning_brief_sections: {
        ...config.morning_brief_sections,
        ...(partial.morning_brief_sections || {}),
      },
    }
    setConfig(updated)

    try {
      await api.updateSecretariaConfig(updated)
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar configuracion')
      // Revert on failure
      await loadConfig()
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* WhatsApp-style icon with purple tint */}
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/40 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">SecretarIA</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Asistente WhatsApp para tu negocio</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <FeatureGate feature="secretaria">
          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Enable toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {config.enabled ? 'SecretarIA esta activo' : 'SecretarIA esta desactivado'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {config.enabled
                      ? 'Gestiona tu negocio desde WhatsApp: consultas, alertas y brief diario.'
                      : 'Activa para gestionar tu negocio desde WhatsApp.'
                    }
                  </p>
                </div>
                <button
                  onClick={() => handleUpdateConfig({ enabled: !config.enabled })}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                    config.enabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      config.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {config.enabled && (
                <>
                  {/* Divider */}
                  <hr className="border-gray-200 dark:border-gray-700" />

                  {/* Phone linking */}
                  <PhoneLinkingArea />

                  {/* Divider */}
                  <hr className="border-gray-200 dark:border-gray-700" />

                  {/* Morning brief config */}
                  <MorningBriefConfig config={config} onUpdate={handleUpdateConfig} />

                  {/* Divider */}
                  <hr className="border-gray-200 dark:border-gray-700" />

                  {/* Usage dashboard */}
                  <UsageDashboard />

                  {/* Divider */}
                  <hr className="border-gray-200 dark:border-gray-700" />

                  {/* Conversation history */}
                  <ConversationHistory />
                </>
              )}
            </div>
          )}
        </FeatureGate>
      </CardContent>
    </Card>
  )
}
