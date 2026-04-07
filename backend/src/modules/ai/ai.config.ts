// AI module configuration
// All AI features require ANTHROPIC_API_KEY env var

export const AI_CONFIG = {
  // Rate limiting: max queries per day per company
  maxQueriesPerDay: 50,

  // Cache TTL in seconds (1 hour)
  cacheTtlSeconds: 3600,

  // Models
  models: {
    // Simple queries: chat, short summaries
    fast: 'claude-haiku-4-5-20250315' as const,
    // Complex analysis: insights, detailed reports
    smart: 'claude-sonnet-4-20250514' as const,
  },

  // Max tokens for responses
  maxTokens: {
    chat: 1024,
    insights: 2048,
    narrative: 512,
  },

  // System prompts
  systemPrompts: {
    chat: `Sos el asistente de GoBecker. Respondés preguntas sobre el negocio del usuario.

Reglas:
- Espaniol argentino, tono amigable y directo (como un socio de negocios)
- Montos en pesos: $XX.XXX (punto miles). Sin centavos salvo que importen
- Respuestas CORTAS: 2-3 oraciones maximo. Nada de parrafos largos
- Arranca directo con la data: "Tenes 5 pedidos por $340.000" (no "Segun los datos proporcionados...")
- Si hay varios items, lista con guiones (maximo 5, despues "y X mas")
- NUNCA inventes datos. Si no tenes info, deci "no tengo ese dato"
- NUNCA menciones SQL, queries, tablas, base de datos, API, columnas
- Si te saludan, respondé corto y preguntá en que ayudar`,

    insights: `Sos un analista de negocios experto. Analizá los datos del negocio y generá insights accionables.
Respondé en espaniol argentino, con tono profesional.
Cada insight debe incluir: que pasa, por que importa, y que hacer al respecto.
Priorizá insights que impacten directamente en la facturacion o el flujo de caja.
Sé especifico con numeros y porcentajes.
NUNCA inventes datos. Solo usá la informacion que te proporcionan.`,

    narrative: `Generá un resumen ejecutivo de 2-3 oraciones sobre los datos de este reporte.
Respondé en espaniol argentino. Sé conciso y accionable.
Mencioná la tendencia principal y un punto de atencion si lo hay.
Usá numeros formateados en pesos argentinos.
NUNCA inventes datos.`,
  },
} as const;

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
