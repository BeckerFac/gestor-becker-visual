import crypto from 'node:crypto'
import logger from '../../config/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncomingMessage {
  readonly from: string
  readonly messageId: string
  readonly type: 'text' | 'audio' | 'image' | 'document' | 'location' | 'button' | 'interactive'
  readonly text?: string
  readonly mediaId?: string
  readonly timestamp: number
}

interface InteractiveButton {
  readonly id: string
  readonly title: string
}

interface TemplateVariable {
  readonly type: 'text'
  readonly text: string
}

// ---------------------------------------------------------------------------
// Config (reads from process.env directly - another agent adds to env.ts)
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
  } as const
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'
const MAX_TEXT_LENGTH = 4096
const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const

// ---------------------------------------------------------------------------
// WhatsAppClient
// ---------------------------------------------------------------------------

export class WhatsAppClient {
  private rateLimitedUntil = 0

  // -------------------------------------------------------------------------
  // Webhook verification
  // -------------------------------------------------------------------------

  verifyWebhook(query: Record<string, string | undefined>): string | null {
    const mode = query['hub.mode']
    const token = query['hub.verify_token']
    const challenge = query['hub.challenge']

    const { verifyToken } = getConfig()

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      logger.info('[WhatsApp] Webhook verified')
      return challenge
    }

    logger.warn('[WhatsApp] Webhook verification failed')
    return null
  }

  // -------------------------------------------------------------------------
  // Signature validation (X-Hub-Signature-256)
  // -------------------------------------------------------------------------

  validateWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const { appSecret } = getConfig()

    if (!appSecret) {
      logger.warn('[WhatsApp] WHATSAPP_APP_SECRET not configured - skipping signature validation')
      return false
    }

    if (!signature) {
      return false
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')

    const sigBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  }

  // -------------------------------------------------------------------------
  // Parse incoming webhook payload
  // -------------------------------------------------------------------------

  parseIncomingMessage(payload: any): IncomingMessage | null {
    try {
      const entry = payload?.entry?.[0]
      const change = entry?.changes?.[0]
      const value = change?.value
      const message = value?.messages?.[0]

      if (!message) {
        return null
      }

      const base = {
        from: message.from as string,
        messageId: message.id as string,
        timestamp: parseInt(message.timestamp, 10) || Date.now() / 1000,
      }

      switch (message.type) {
        case 'text':
          return { ...base, type: 'text', text: message.text?.body }

        case 'audio':
          return { ...base, type: 'audio', mediaId: message.audio?.id }

        case 'image':
          return { ...base, type: 'image', mediaId: message.image?.id, text: message.image?.caption }

        case 'document':
          return { ...base, type: 'document', mediaId: message.document?.id, text: message.document?.caption }

        case 'location':
          return {
            ...base,
            type: 'location',
            text: `${message.location?.latitude},${message.location?.longitude}`,
          }

        case 'button':
          return { ...base, type: 'button', text: message.button?.text }

        case 'interactive': {
          const interactive = message.interactive
          const reply = interactive?.button_reply || interactive?.list_reply
          return { ...base, type: 'interactive', text: reply?.id }
        }

        default:
          logger.warn({ type: message.type }, '[WhatsApp] Unsupported message type')
          return null
      }
    } catch (error) {
      logger.error({ err: error }, '[WhatsApp] Failed to parse incoming message')
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Send text message
  // -------------------------------------------------------------------------

  async sendTextMessage(to: string, text: string): Promise<boolean> {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH - 3) + '...'
      : text

    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: truncated },
    })
  }

  // -------------------------------------------------------------------------
  // Send document (PDF, Excel, etc.)
  // -------------------------------------------------------------------------

  async sendDocument(to: string, url: string, filename: string, caption?: string): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { link: url, filename, ...(caption ? { caption } : {}) },
    })
  }

  // -------------------------------------------------------------------------
  // Send image
  // -------------------------------------------------------------------------

  async sendImage(to: string, url: string, caption?: string): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: url, ...(caption ? { caption } : {}) },
    })
  }

  // -------------------------------------------------------------------------
  // Send interactive buttons
  // -------------------------------------------------------------------------

  async sendInteractiveButtons(to: string, bodyText: string, buttons: readonly InteractiveButton[]): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    })
  }

  // -------------------------------------------------------------------------
  // Mark as read (blue ticks)
  // -------------------------------------------------------------------------

  async markAsRead(messageId: string): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    })
  }

  // -------------------------------------------------------------------------
  // Download media
  // -------------------------------------------------------------------------

  async downloadMedia(mediaId: string): Promise<Buffer | null> {
    const { accessToken } = getConfig()

    if (!accessToken) {
      logger.warn('[WhatsApp] WHATSAPP_ACCESS_TOKEN not configured - cannot download media')
      return null
    }

    try {
      // Step 1: Get the media URL
      const metaResponse = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaResponse.ok) {
        logger.error({ status: metaResponse.status }, '[WhatsApp] Failed to get media URL')
        return null
      }

      const metaData = await metaResponse.json() as { url?: string }

      if (!metaData.url) {
        logger.error('[WhatsApp] No URL in media metadata')
        return null
      }

      // Step 2: Download the binary
      const mediaResponse = await fetch(metaData.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!mediaResponse.ok) {
        logger.error({ status: mediaResponse.status }, '[WhatsApp] Failed to download media')
        return null
      }

      const arrayBuffer = await mediaResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (error) {
      logger.error({ err: error }, '[WhatsApp] Media download failed')
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Send template message (for outside 24h window)
  // -------------------------------------------------------------------------

  async sendTemplate(
    to: string,
    templateName: string,
    variables: readonly TemplateVariable[],
  ): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'es_AR' },
        components: variables.length > 0
          ? [{ type: 'body', parameters: variables }]
          : [],
      },
    })
  }

  // -------------------------------------------------------------------------
  // Internal: send message with retry + rate limit handling
  // -------------------------------------------------------------------------

  private async sendMessage(body: Record<string, unknown>): Promise<boolean> {
    const { accessToken, phoneNumberId } = getConfig()

    if (!accessToken) {
      logger.warn('[WhatsApp] WHATSAPP_ACCESS_TOKEN not configured - message not sent')
      return false
    }

    // Rate limit pause
    if (Date.now() < this.rateLimitedUntil) {
      logger.warn('[WhatsApp] Rate limited - skipping send')
      return false
    }

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        if (response.ok) {
          return true
        }

        const status = response.status

        // Rate limited
        if (status === 429) {
          this.rateLimitedUntil = Date.now() + 60_000
          logger.warn('[WhatsApp] Rate limited by Meta API - pausing sends for 60s')
        }

        // Retry on 429 and 5xx
        if ((status === 429 || status >= 500) && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 4000
          logger.warn({ status, attempt: attempt + 1 }, `[WhatsApp] API error, retrying in ${delay}ms`)
          await this.sleep(delay)
          continue
        }

        // Non-retryable error
        const errorBody = await response.text().catch(() => 'unknown')
        logger.error({ status, errorBody }, '[WhatsApp] API error')
        return false
      } catch (error) {
        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 4000
          logger.warn({ attempt: attempt + 1 }, `[WhatsApp] Network error, retrying in ${delay}ms`)
          await this.sleep(delay)
          continue
        }
        logger.error({ err: error }, '[WhatsApp] Send failed after retries')
        return false
      }
    }

    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const whatsappClient = new WhatsAppClient()
