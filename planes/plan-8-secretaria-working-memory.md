# Plan 8: Working Memory para Operaciones en Curso

## Problema
Cuando el usuario esta en medio de una operacion (ej: creando una factura), no hay un estado estructurado que le diga a Claude "estamos en medio de X con estos datos". Claude depende solo del historial de texto, que puede ser ambiguo o truncado.

**Ejemplo real**: Usuario confirma factura parcial. Claude dice "de que empresa?" porque no tiene un estado claro de "estamos facturando 2 items del pedido #0002 de BeckerVisual".

## Solucion

### Concepto: Inyectar `<working_memory>` en el system prompt

Cada vez que hay una pending_action activa, se agrega un bloque estructurado al system prompt:

```xml
<working_memory>
  <operacion_en_curso>FACTURACION_PARCIAL</operacion_en_curso>
  <pedido numero="0002" uuid="abc-123">
    <empresa>BeckerVisual</empresa>
    <items_totales>3x GoBecker Intermedio a $70.785 c/u</items_totales>
    <items_a_facturar>2 unidades</items_a_facturar>
    <neto>$141.570</neto>
    <iva>$29.729,70</iva>
    <total>$171.299,70</total>
  </pedido>
  <estado>PENDIENTE_CONFIRMACION</estado>
  <instruccion>El usuario debe confirmar con "si" o cancelar con "no". Si confirma, ejecuta crear_factura con confirmar=true.</instruccion>
</working_memory>
```

### Cambio 1: Funcion buildWorkingMemory()

**Archivo nuevo**: NO. Se agrega a `secretaria.v3.ts`

```typescript
async function buildWorkingMemory(companyId: string, channelId: string): Promise<string> {
  const pendingAction = await secretariaSafety.getPendingAction(companyId, channelId);
  if (!pendingAction) return '';
  
  const { actionType, actionData } = pendingAction;
  
  return `
<working_memory>
  <operacion_en_curso>${actionType}</operacion_en_curso>
  <datos>${JSON.stringify(actionData, null, 2)}</datos>
  <estado>PENDIENTE_CONFIRMACION</estado>
  <instruccion>
    El usuario ya vio un preview de esta operacion. 
    Si confirma (si, dale, confirmo, etc.), ejecuta la operacion inmediatamente.
    Si cancela (no, mejor no, cancelar), cancela la operacion.
    Si pide cambios, muestra el preview actualizado.
    NO vuelvas a pedir datos que ya estan en esta working_memory.
  </instruccion>
</working_memory>`;
}
```

### Cambio 2: Inyectar en buildSystemPrompt()

**Archivo**: `secretaria.v3.ts` linea ~84

```typescript
export function buildSystemPrompt(companyName: string, userName: string, workingMemory: string = ''): string {
  return `...prompt existente...
${workingMemory}`;
}
```

### Cambio 3: Pasar working memory a handleConversation()

**Archivo**: `secretaria.v3.ts` - handleConversation()

```typescript
export async function handleConversation(
  companyId: string, userId: string, message: string,
  conversationHistory: ConversationMessage[],
  companyName: string, userName: string
): Promise<{response: string, toolsCalled: string[], messages: any[]}> {
  
  const workingMemory = await buildWorkingMemory(companyId, `web-${userId}`);
  const systemPrompt = buildSystemPrompt(companyName, userName, workingMemory);
  // ... rest
}
```

### Cambio 4: Actualizar pendingAction al crear preview

Cuando `crear_pedido` o `crear_factura` genera un preview (sin confirmar=true), se guarda como pendingAction con TODOS los datos resueltos:

```typescript
case 'crear_pedido': {
  if (!input.confirmar) {
    // Guardar pending action con datos completos
    await secretariaSafety.createPendingAction({
      companyId, userId, 
      channel: 'web', channelId: `web-${userId}`,
      actionType: 'crear_pedido',
      actionData: {
        enterprise_id: resolvedEnterprise.id,
        enterprise_name: resolvedEnterprise.name,
        items: resolvedItems,
        neto, iva, total,
        discount_percent: input.descuento || 0,
        originalInput: input
      }
    });
    return `PREVIEW...`;
  }
}
```

### Cambio 5: Limpiar working memory post-ejecucion

Despues de ejecutar o cancelar una accion, se limpia la pendingAction (ya existe con `confirmPendingAction` y `cancelPendingAction`).

## Archivos a modificar
| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `secretaria.v3.ts` | +buildWorkingMemory(), inyectar en prompt, guardar pendingAction en tools | Media |
| `secretaria.safety.ts` | Sin cambios (ya tiene createPendingAction/getPendingAction) | Ninguna |

## Verificacion
1. Crear pedido → preview → "si" → ejecuta sin preguntar datos otra vez
2. Crear pedido → preview → "no" → cancela limpiamente
3. Crear pedido → preview → "cambiame el precio" → preview actualizado
4. 2 operaciones rapidas → solo la ultima se guarda como pendiente
5. Timeout de 5 min → working memory se limpia sola

## Dependencia
- Funciona independiente de Plan 6/7
- Se beneficia enormemente de Plan 6 (historial con tool results)
