# Plan 10: Compactacion de Contexto para Conversaciones Largas

## Problema
Con el Plan 6 implementado, cada turno puede generar 3-4 mensajes (user, assistant+tool_use, user+tool_result, assistant). A los 10 turnos hay 30-40 mensajes. Con tool_results que devuelven JSON completo de pedidos/facturas/clientes, el contexto crece rapidamente.

**Dato clave (Microsoft Research)**: LLMs pierden 39% de rendimiento en el turno 9. El contexto gigante causa "context rot" - Claude se confunde con datos viejos vs nuevos.

## Solucion

### Estrategia: 3 niveles de compactacion

**Nivel 1: Tool result clearing** (inmediato)
- Despues de que un tool_result fue procesado y Claude respondio, reemplazar el contenido del tool_result viejo con un resumen corto
- Solo mantener tool_results completos de los ultimos 3 turnos

**Nivel 2: Sliding window con summary** (al cargar)
- Mantener ultimos N turnos completos (N=6, ~18-24 mensajes)
- Turnos anteriores se resumen en un bloque `<conversation_summary>` al inicio

**Nivel 3: Token counting** (preventivo)
- Contar tokens aproximados del historial
- Si excede 80% del limite del modelo, comprimir mas agresivamente

### Cambio 1: Funcion compactToolResults()

**Archivo**: `secretaria.v3.ts`

```typescript
function compactToolResults(messages: MessageParam[], keepLastN: number = 6): MessageParam[] {
  const total = messages.length;
  if (total <= keepLastN) return messages;
  
  return messages.map((msg, i) => {
    // Solo compactar mensajes viejos (no los ultimos N)
    if (i >= total - keepLastN) return msg;
    
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const newContent = msg.content.map((block: any) => {
        if (block.type === 'tool_result') {
          // Parsear el resultado original y resumir
          const summary = summarizeToolResult(block.content);
          return {
            ...block,
            content: summary // Reemplazar con resumen
          };
        }
        return block;
      });
      return { ...msg, content: newContent };
    }
    return msg;
  });
}

function summarizeToolResult(content: string): string {
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return `[${data.length} resultados - datos procesados]`;
    }
    if (data.error) return `[Error: ${data.error}]`;
    return `[Resultado procesado]`;
  } catch {
    // Si no es JSON, truncar
    return content.length > 200 ? content.substring(0, 200) + '...' : content;
  }
}
```

### Cambio 2: Funcion buildConversationSummary()

**Archivo**: `secretaria.v3.ts`

```typescript
async function buildConversationSummary(
  oldMessages: ConversationMessage[]
): Promise<string> {
  if (oldMessages.length === 0) return '';
  
  // Extraer temas clave de los mensajes viejos
  const topics: string[] = [];
  for (const msg of oldMessages) {
    if (msg.role === 'user') {
      topics.push(`- Usuario: ${msg.content.substring(0, 100)}`);
    }
  }
  
  return `<conversation_summary>
Resumen de la conversacion anterior (${oldMessages.length} mensajes):
${topics.join('\n')}
</conversation_summary>`;
}
```

### Cambio 3: Aplicar compactacion al construir messages

**Archivo**: `secretaria.v3.ts` - handleConversation()

```typescript
// Cargar historial
const allHistory = conversationHistory;
const RECENT_WINDOW = 12; // ~4 turnos completos

if (allHistory.length > RECENT_WINDOW) {
  // Resumir mensajes viejos
  const oldMessages = allHistory.slice(0, -RECENT_WINDOW);
  const recentMessages = allHistory.slice(-RECENT_WINDOW);
  
  const summary = await buildConversationSummary(oldMessages);
  
  // Primero el summary como contexto
  if (summary) {
    messages.push({ role: 'user', content: summary });
    messages.push({ role: 'assistant', content: 'Entendido, tengo el contexto de la conversacion anterior.' });
  }
  
  // Luego los mensajes recientes completos
  for (const msg of recentMessages) {
    if (msg.content_blocks && msg.content_blocks.length > 0) {
      messages.push({ role: msg.role, content: msg.content_blocks });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
} else {
  // Pocos mensajes, pasar todos
  for (const msg of allHistory) {
    if (msg.content_blocks && msg.content_blocks.length > 0) {
      messages.push({ role: msg.role, content: msg.content_blocks });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
}

// Compactar tool_results viejos dentro de la ventana
messages = compactToolResults(messages, 6);
```

### Cambio 4: Token counting aproximado

```typescript
function estimateTokens(messages: MessageParam[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') chars += block.text.length;
        else if (block.type === 'tool_use') chars += JSON.stringify(block.input).length;
        else if (block.type === 'tool_result') {
          chars += typeof block.content === 'string' ? block.content.length : 200;
        }
      }
    }
  }
  // ~4 chars per token (conservative estimate)
  return Math.ceil(chars / 4);
}
```

Si tokens > 150K (80% de 200K de Sonnet), comprimir mas agresivamente:
- Reducir RECENT_WINDOW a 6
- Truncar tool_results a 500 chars
- Resumir mas agresivamente

### Cambio 5: Aumentar limite de mensajes cargados

**Archivo**: `secretaria.service.ts` - loadRecentMessages()

Cambiar de 20 a 50 mensajes. La compactacion se encarga de que no sea demasiado para Claude.

```typescript
const recentMessages = await this.loadRecentMessages(companyId, channelId, 50);
```

## Archivos a modificar
| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `secretaria.v3.ts` | +compactToolResults(), +buildConversationSummary(), +estimateTokens() | Media |
| `secretaria.service.ts` | Aumentar limite de mensajes a 50 | Baja |

## Verificacion
1. Conversacion de 5 turnos → mensajes viejos compactados, recientes completos
2. Conversacion de 15+ turnos → summary generado, no excede tokens
3. Tool results viejos → resumidos a 1 linea
4. Tool results recientes (ultimos 3 turnos) → completos
5. Performance: tiempo de respuesta no aumenta significativamente
6. Contexto: Claude sigue entendiendo la conversacion despues de compactacion

## Dependencia
- Requiere Plan 6 implementado (content_blocks en historial)
- Se aplica DESPUES de Plan 6 y 7

## Riesgos
- Compactacion muy agresiva pierde datos necesarios → ajustar RECENT_WINDOW
- Summary LLM-generated seria mas preciso pero costoso → usar extractivo simple por ahora
- Token counting es aproximado → usar margen conservador
