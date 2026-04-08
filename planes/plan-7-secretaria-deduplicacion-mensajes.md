# Plan 7: Fix Deduplicacion de Mensajes

## Problema
En `handleWebChat()`, el mensaje del usuario se guarda en DB (linea 529) ANTES de cargar el historial (linea 603). Cuando `loadRecentMessages()` ejecuta, el mensaje recien guardado ya esta en la DB. Luego `handleConversation()` lo agrega OTRA VEZ al array de messages (linea 488). Resultado: el mensaje del usuario aparece **duplicado** en el contexto de Claude.

## Flujo actual (buggy):
```
1. Usuario envia "facturame el pedido 0002"
2. saveConversationMessage("user", "facturame el pedido 0002")  ← GUARDA EN DB
3. recentMessages = loadRecentMessages(20)  ← INCLUYE el mensaje recien guardado
4. handleConversation(message, history)  
   → history ya tiene "facturame el pedido 0002"
   → agrega OTRA VEZ: messages.push({role:'user', content: message})
5. Claude ve el mensaje 2 veces
```

## Solucion

### Estrategia: NO guardar el mensaje del usuario antes de llamar a v3

El mensaje del usuario se guarda como parte del flujo de mensajes intermedios (Plan 6). Es decir:
- Se elimina el `saveConversationMessage` temprano para el mensaje del usuario
- El mensaje se guarda cuando v3 retorna los mensajes completos
- Esto tambien se aplica al response del assistant (ya no se guarda por separado)

### Cambio 1: handleWebChat() - Eliminar save temprano

**Archivo**: `secretaria.service.ts`

```typescript
// ELIMINAR esta linea (~529):
await this.saveConversationMessage(companyId, channelId, 'user', truncatedMessage);

// El mensaje se guarda despues cuando procesamos result.messages
```

### Cambio 2: handleWebChat() - Eliminar save del response

```typescript
// ELIMINAR esta linea (~635):
await this.saveConversationMessage(companyId, channelId, 'assistant', responseText);

// Ya se guardo como parte de result.messages en Plan 6
```

### Cambio 3: Guardar mensaje del usuario al inicio del array de messages en v3

**Archivo**: `secretaria.v3.ts`

El mensaje del usuario ya se agrega en la linea 488. Ahora el retorno de `handleConversation()` incluye este mensaje en `result.messages`. El service guarda todo junto.

### Cambio 4: processMessage() (WhatsApp) - Misma logica

**Archivo**: `secretaria.service.ts` - processMessage()

Mismo patron: mover el save del mensaje del usuario a despues del procesamiento.
Pero OJO: processMessage() no usa v3 todavia (usa el pipeline viejo). Solo aplicar este cambio cuando se migre WhatsApp a v3.

Por ahora: agregar un flag para evitar doble-guardado:
```typescript
// Al cargar historial, excluir el mensaje actual del usuario
const recentMessages = await this.loadRecentMessages(companyId, channelId, 20);
// Filtrar el ultimo mensaje si es del usuario y es identico al actual
const filtered = recentMessages.filter(m => 
  !(m.role === 'user' && m.content === truncatedMessage && 
    Date.now() - m.created_at.getTime() < 5000)
);
```

## Archivos a modificar
| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `secretaria.service.ts` | Reordenar save/load, eliminar saves duplicados | Media |

## Verificacion
1. Enviar mensaje → verificar en DB que aparece UNA sola vez
2. Cargar historial → verificar que no hay duplicados
3. Conversacion multi-turno → cada mensaje aparece 1 vez en el contexto de Claude
4. Verificar que la logica de deduplicacion no pierde mensajes legitimos identicos

## Dependencia
- Depende de Plan 6 (content_blocks) para el guardado completo de mensajes
- Se implementa JUNTO con Plan 6

## Riesgos
- Si el save falla despues de v3, se pierde el mensaje → agregar try/catch con retry
- Race condition: 2 mensajes rapidos → usar transaction o lock
