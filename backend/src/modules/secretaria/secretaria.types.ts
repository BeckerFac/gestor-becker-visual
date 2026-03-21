// SecretarIA — WhatsApp AI Assistant types

// ── WhatsApp Webhook Types ──

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'document' | 'interactive' | 'button';
  text?: { body: string };
  audio?: { id: string; mime_type: string };
  image?: { id: string; mime_type: string; caption?: string };
  button?: { text: string; payload: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
}

export interface WhatsAppChangeValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: WhatsAppMessage[];
  statuses?: Array<{ id: string; status: string; timestamp: string }>;
}

export interface WhatsAppEntry {
  id: string;
  changes: Array<{ value: WhatsAppChangeValue; field: string }>;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

// ── Intent Classification ──

export type SecretariaIntent =
  | 'query_clients'
  | 'query_products'
  | 'query_invoices'
  | 'query_balances'
  | 'query_orders'
  | 'query_general'
  | 'query_activity'
  | 'morning_brief'
  | 'send_document'
  | 'help'
  | 'greeting'
  | 'unknown';

export interface IntentClassification {
  intent: SecretariaIntent;
  confidence: number;
  entities: Record<string, string>;
  original_text: string;
}

// ── Conversation Context ──

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

export interface SecretariaContext {
  companyId: string;
  userId: string;
  phoneNumber: string;
  displayName: string;
  recentMessages: ConversationMessage[];
  memory: Record<string, string>;
}

// ── Tool Results ──

export interface ToolResult {
  toolName: string;
  data: unknown;
  formatted: string;
}

// ── Configuration ──

export interface SecretariaConfig {
  companyId: string;
  enabled: boolean;
  morningBriefEnabled: boolean;
  morningBriefTime: string; // HH:mm format
  timezone: string;
  lastBriefDate: string | null; // YYYY-MM-DD or null
  briefSections: readonly string[]; // subset of available sections
}

export interface LinkedPhone {
  id: string;
  companyId: string;
  userId: string;
  phoneNumber: string;
  linkingCode: string | null;
  linkingCodeExpires: Date | null;
  verified: boolean;
  createdAt: Date;
}

export interface UsageTracking {
  companyId: string;
  month: string; // YYYY-MM
  messagesReceived: number;
  messagesSent: number;
  llmTokensInput: number;
  llmTokensOutput: number;
  sttMinutes: number;
  estimatedCostUsd: number;
}
