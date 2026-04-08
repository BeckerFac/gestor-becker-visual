# Plan 6: Persistir Historial Completo (tool_use + tool_result)

## Problema
SecretarIA guarda solo `{role, content: string}` en `secretaria_conversations`. Cuando Claude hace un tool_use (buscar_pedidos, etc.), el resultado del tool se pierde entre turnos. En el siguiente mensaje del usuario, Claude NO tiene acceso a los datos que busco antes.

**Ejemplo real**: Usuario dice "facturame el pedido 0002". Claude busca y encuentra "#0002 BeckerVisual $212.355". Usuario confirma. Claude dice "de que pedido me hablas?" porque no tiene el tool_result anterior.

## Causa raiz
- `saveConversationMessage()` guarda `content: string` (solo texto)
- `loadRecentMessages()` retorna `{role, content: string}`
- `handleConversation()` construye messages como `{role, content: string}` (linea 482-488 de v3.ts)
- Los bloques `tool_use` y `tool_result` de Anthropic API se pierden completamente

## Solucion

### Cambio 1: Nueva columna en DB para content estructurado

```sql
ALTER TABLE secretaria_conversations 
ADD COLUMN IF NOT EXISTS content_blocks JSONB;
```

`content_blocks` almacena el array completo de Anthropic:
- Para assistant: `[{type:"text", text:"..."}, {type:"tool_use", id:"toolu_abc", name:"buscar_pedidos", input:{...}}]`
- Para user tool_result: `[{type:"tool_result", tool_use_id:"toolu_abc", content:"..."}]`
- Para user texto: `[{type:"text", text:"..."}]` o null (usar content string)

### Cambio 2: Actualizar saveConversationMessage()

**Archivo**: `secretaria.service.ts` lineas 905-919

```typescript
// ANTES:
async saveConversationMessage(companyId: string, phoneNumber: string, role: string, content: string)

// DESPUES:
async saveConversationMessage(
  companyId: string, 
  phoneNumber: string, 
  role: string, 
  content: string,
  contentBlocks?: any[] // Anthropic content blocks
)
```

Query actualizado:
```sql
INSERT INTO secretaria_conversations (company_id, phone_number, role, content, content_blocks) 
VALUES ($1, $2, $3, $4, $5)
```

### Cambio 3: Actualizar loadRecentMessages()

**Archivo**: `secretaria.service.ts` lineas 921-940

```sql
SELECT role, content, content_blocks, created_at 
FROM secretaria_conversations 
WHERE company_id = $1 AND phone_number = $2 
ORDER BY created_at DESC 
LIMIT $3
```

Retornar `contentBlocks` en ConversationMessage.

### Cambio 4: Actualizar ConversationMessage type

**Archivo**: `secretaria.types.ts` linea 72-76

```typescript
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_blocks?: any[]; // Anthropic MessageParam content
  created_at: Date;
}
```

### Cambio 5: Guardar tool_use y tool_result en handleConversation()

**Archivo**: `secretaria.v3.ts` - la funcion handleConversation() debe retornar los mensajes completos para que el service los guarde.

Retorno actual: `{ response: string, toolsCalled: string[] }`
Retorno nuevo: `{ response: string, toolsCalled: string[], messages: MessageParam[] }`

El service guarda:
1. Cada response del assistant con sus content blocks (incluyendo tool_use)
2. Cada tool_result como mensaje user con content_blocks

### Cambio 6: Reconstruir historial al cargar

**Archivo**: `secretaria.v3.ts` lineas 480-488

```typescript
// ANTES:
for (const msg of conversationHistory.slice(-20)) {
  messages.push({ role: msg.role, content: msg.content });
}

// DESPUES:
for (const msg of conversationHistory.slice(-20)) {
  if (msg.content_blocks && msg.content_blocks.length > 0) {
    messages.push({ role: msg.role, content: msg.content_blocks });
  } else {
    messages.push({ role: msg.role, content: msg.content });
  }
}
```

### Cambio 7: Guardar mensajes intermedios en handleWebChat()

**Archivo**: `secretaria.service.ts` lineas 603-617

Despues de llamar a handleConversation(), guardar todos los mensajes intermedios:
```typescript
const result = await handleConversation(...);
// Guardar cada mensaje intermedio (tool_use + tool_result)
for (const msg of result.messages) {
  await this.saveConversationMessage(companyId, channelId, msg.role, 
    typeof msg.content === 'string' ? msg.content : '', 
    Array.isArray(msg.content) ? msg.content : undefined
  );
}
```

## Archivos a modificar
| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `db.ts` | +1 columna content_blocks JSONB | Baja |
| `secretaria.types.ts` | +content_blocks en ConversationMessage | Baja |
| `secretaria.service.ts` | saveConversationMessage + loadRecentMessages + handleWebChat | Media |
| `secretaria.v3.ts` | Retornar messages[], reconstruir historial con blocks | Media |

## Verificacion
1. Enviar "mostrame el pedido 0002" → agente busca y responde
2. Enviar "facturame 2 unidades de ese" → agente DEBE recordar que es el pedido 0002
3. Verificar en DB: content_blocks contiene los tool_use y tool_result
4. Verificar: historial reconstruido incluye bloques tool_use/tool_result
5. Verificar: no hay mensajes duplicados en el historial

## Riesgos
- JSONB puede ser grande si los tool_result tienen mucha data → se resuelve en Plan 10 (compactacion)
- Mensajes viejos sin content_blocks: fallback a content string (retrocompatible)
- WhatsApp pipeline (processMessage) NO usa v3 todavia → cambios aplican solo a web por ahora
