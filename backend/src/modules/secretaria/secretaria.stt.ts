// SecretarIA — Speech-to-Text service using Deepgram Nova-3

import { DeepgramClient } from '@deepgram/sdk';
import logger from '../../config/logger';

// ── Types ──

export interface STTResult {
  readonly text: string;
  readonly confidence: number;
  readonly duration_seconds: number;
  readonly detected_language?: string;
}

// ── Constants ──

const MAX_AUDIO_DURATION_SECONDS = 300; // 5 minutes
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const DEEPGRAM_COST_PER_MINUTE_USD = 0.0043;

// ── Transcription cache (keyed by WhatsApp message/media ID) ──

const transcriptionCache = new Map<string, STTResult>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key: string): STTResult | null {
  return transcriptionCache.get(key) ?? null;
}

function setCache(key: string, result: STTResult): void {
  transcriptionCache.set(key, result);
  setTimeout(() => transcriptionCache.delete(key), CACHE_TTL_MS);
}

// ── Service ──

class DeepgramSTTService {
  private getClient(): DeepgramClient | null {
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      return null;
    }

    return new DeepgramClient({ apiKey });
  }

  /**
   * Transcribe an audio buffer using Deepgram Nova-3.
   */
  async transcribeAudio(audioBuffer: Buffer, _mimeType: string): Promise<STTResult> {
    const client = this.getClient();

    if (!client) {
      logger.warn('DeepgramSTTService: DEEPGRAM_API_KEY not configured');
      return {
        text: 'El procesamiento de audio no esta configurado.',
        confidence: 0,
        duration_seconds: 0,
      };
    }

    try {
      const result = await client.listen.v1.media.transcribeFile(audioBuffer, {
        model: 'nova-3',
        language: 'es',
        smart_format: true,
        punctuate: true,
        detect_language: true,
      });

      // The response might be an accepted (async) response — we only handle sync
      if (!('results' in result)) {
        logger.error('DeepgramSTTService: received async response instead of sync');
        return {
          text: 'No pude procesar el audio. Intenta de nuevo.',
          confidence: 0,
          duration_seconds: 0,
        };
      }

      const duration = result.metadata?.duration ?? 0;
      const channel = result.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];
      const transcript = alternative?.transcript ?? '';
      const confidence = alternative?.confidence ?? 0;
      const detectedLanguage = channel?.detected_language;

      return {
        text: transcript,
        confidence,
        duration_seconds: duration,
        detected_language: detectedLanguage ?? undefined,
      };
    } catch (error: unknown) {
      logger.error({ err: error }, 'DeepgramSTTService: transcription failed');
      return {
        text: 'No pude entender el audio.',
        confidence: 0,
        duration_seconds: 0,
      };
    }
  }

  /**
   * Download audio from WhatsApp and transcribe it.
   * Returns a user-friendly message if transcription fails or is not configured.
   */
  async transcribeFromWhatsApp(
    mediaId: string,
    downloadMedia: (mediaId: string) => Promise<Buffer | null>,
  ): Promise<STTResult> {
    // Check cache first
    const cached = getCached(mediaId);

    if (cached) {
      logger.info({ mediaId }, 'DeepgramSTTService: returning cached transcription');
      return cached;
    }

    // Check if Deepgram is configured
    if (!process.env.DEEPGRAM_API_KEY) {
      return {
        text: 'El procesamiento de audio no esta configurado.',
        confidence: 0,
        duration_seconds: 0,
      };
    }

    // Download the audio from WhatsApp
    const audioBuffer = await downloadMedia(mediaId);

    if (!audioBuffer) {
      logger.error({ mediaId }, 'DeepgramSTTService: failed to download media from WhatsApp');
      return {
        text: 'No pude descargar el audio. Intenta enviarlo de nuevo.',
        confidence: 0,
        duration_seconds: 0,
      };
    }

    // WhatsApp audio is typically OGG/OPUS
    const mimeType = 'audio/ogg';
    const result = await this.transcribeAudio(audioBuffer, mimeType);

    // Cache successful transcriptions
    if (result.confidence > 0) {
      setCache(mediaId, result);
    }

    return result;
  }

  /**
   * Validate audio duration and build a user-friendly response from STT result.
   * Returns null if the transcription is valid text; otherwise returns an error/warning message.
   */
  validateAndFormat(result: STTResult): { text: string; warning?: string } | null {
    // Duration check
    if (result.duration_seconds > MAX_AUDIO_DURATION_SECONDS) {
      return {
        text: 'Los audios deben ser de menos de 5 minutos. Podes dividirlo o escribirme el mensaje.',
      };
    }

    // Empty transcription
    if (!result.text.trim() || result.confidence === 0) {
      return {
        text: 'No pude entender el audio, podes escribirlo?',
      };
    }

    // Low confidence
    if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
      return {
        text: result.text,
        warning: `No estoy segura de haber entendido bien. Dijiste: '${result.text}'?`,
      };
    }

    // Non-Spanish detected
    if (result.detected_language && !result.detected_language.startsWith('es')) {
      return {
        text: result.text,
        warning: `Detecte que el audio podria no estar en espanol. Entendi: '${result.text}'`,
      };
    }

    // All good
    return null;
  }

  /**
   * Estimate cost in USD for a given duration.
   */
  estimateCostUsd(durationSeconds: number): number {
    return (durationSeconds / 60) * DEEPGRAM_COST_PER_MINUTE_USD;
  }
}

export const deepgramSTT = new DeepgramSTTService();
