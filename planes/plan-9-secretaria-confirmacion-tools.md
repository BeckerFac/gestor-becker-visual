# Plan 9: Confirmacion como Tools Explicitas (Preview + Execute)

## Problema
El flujo actual de confirmacion depende de:
1. Claude genera un preview como texto
2. El service intercepta "si/no" antes de llamar a v3
3. v3 no sabe que habia un preview pendiente
4. Resultado: desconexion entre safety.ts y v3.ts

Ademas, los write tools actuales tienen `confirmar: boolean` como parametro, lo que permite que Claude llame a la tool con `confirmar: true` sin que el usuario haya confirmado nada.

## Solucion

### Concepto: Separar cada write en 2 tools

Para cada operacion de escritura, crear un par:
- `preview_X`: genera preview con datos resueltos, retorna `preview_id`
- `ejecutar_X`: requiere `preview_id` valido, ejecuta la operacion

Claude NUNCA puede llamar a `ejecutar_X` sin un `preview_id` valido generado previamente.

### Tools nuevas (reemplazan crear_pedido, crear_factura, registrar_cobro):

```typescript
// PEDIDO
{
  name: 'preview_pedido',
  description: 'Genera un preview de pedido SIN crearlo. Muestra el preview al usuario y pide confirmacion. SIEMPRE usar antes de ejecutar_pedido.',
  input_schema: {
    type: 'object',
    properties: {
      empresa: { type: 'string', description: 'Nombre de la empresa' },
      items: { type: 'array', items: { type: 'object', properties: {
        producto: { type: 'string' },
        cantidad: { type: 'number' },
        precio_unitario: { type: 'number' }
      }}},
      descuento: { type: 'number', description: 'Descuento % (opcional)' }
    },
    required: ['empresa', 'items']
  }
},
{
  name: 'ejecutar_pedido',
  description: 'Crea un pedido DEFINITIVO. REQUIERE preview_id de una llamada previa a preview_pedido. NUNCA llamar sin confirmacion explicita del usuario ("si", "dale", "confirmo").',
  input_schema: {
    type: 'object',
    properties: {
      preview_id: { type: 'string', description: 'ID del preview confirmado' }
    },
    required: ['preview_id']
  }
}

// FACTURA
{
  name: 'preview_factura',
  description: 'Genera preview de factura (parcial o total) desde un pedido.',
  input_schema: {
    type: 'object',
    properties: {
      numero_pedido: { type: 'number' },
      items_cantidad: { type: 'number', description: 'Cuantos items facturar (omitir = todos)' },
      tipo_factura: { type: 'string', enum: ['A', 'B', 'C'] }
    },
    required: ['numero_pedido']
  }
},
{
  name: 'ejecutar_factura',
  description: 'Emite la factura definitiva. REQUIERE preview_id.',
  input_schema: {
    type: 'object',
    properties: {
      preview_id: { type: 'string' }
    },
    required: ['preview_id']
  }
}

// COBRO
{
  name: 'preview_cobro',
  description: 'Genera preview de cobro/recibo.',
  input_schema: {
    type: 'object',
    properties: {
      empresa: { type: 'string' },
      monto: { type: 'number' },
      metodos_pago: { type: 'array', items: { type: 'object', properties: {
        metodo: { type: 'string', enum: ['efectivo', 'transferencia', 'cheque', 'tarjeta'] },
        monto: { type: 'number' }
      }}},
      factura_ids: { type: 'array', items: { type: 'string' } }
    },
    required: ['empresa', 'monto']
  }
},
{
  name: 'ejecutar_cobro',
  description: 'Registra el cobro definitivo. REQUIERE preview_id.',
  input_schema: {
    type: 'object',
    properties: {
      preview_id: { type: 'string' }
    },
    required: ['preview_id']
  }
}
```

### Implementacion de preview tools

Cada `preview_X` tool:
1. Resuelve nombres a IDs (fuzzy match via resolver)
2. Calcula totales (neto, IVA, descuento)
3. Valida con constitutional validator (7 capas)
4. Si pasa validacion: genera `preview_id` (UUID) y guarda en pending_actions
5. Retorna string formateado para el usuario + `preview_id`

```typescript
case 'preview_pedido': {
  const enterprise = await resolveEnterprise(companyId, input.empresa);
  if (!enterprise) return `No encontre la empresa "${input.empresa}". Puede ser: ${suggestions}`;
  if (enterprise.ambiguous) return `Hay varias empresas: ${enterprise.options}. Cual?`;
  
  const items = await resolveItems(companyId, input.items);
  const { neto, iva, total } = calculateTotals(items, input.descuento);
  
  // Validar
  const validation = await validateAction('crear_pedido', { enterprise, items, total });
  if (!validation.valid) return validation.error;
  
  // Guardar preview
  const previewId = await secretariaSafety.createPendingAction({
    companyId, userId, channel: 'web', channelId,
    actionType: 'crear_pedido',
    actionData: { enterprise_id: enterprise.id, items: resolvedItems, neto, iva, total, discount: input.descuento }
  });
  
  return `PREVIEW (ID: ${previewId})\n` +
    `Pedido para *${enterprise.name}*:\n` +
    items.map(i => `- ${i.qty}x ${i.name} a $${i.price} c/u`).join('\n') +
    `\nNeto: $${neto} | IVA: $${iva} | Total: $${total}\n` +
    `Confirmas?`;
}
```

### Implementacion de ejecutar tools

Cada `ejecutar_X` tool:
1. Busca pending_action por preview_id
2. Verifica que no expire y que el status es 'pending'
3. Ejecuta via service existente
4. Marca pending_action como 'confirmed'
5. Retorna resultado

```typescript
case 'ejecutar_pedido': {
  const action = await secretariaSafety.getPendingActionById(input.preview_id);
  if (!action) return 'El preview expiro o no existe. Genera uno nuevo.';
  if (action.status !== 'pending') return 'Esta operacion ya fue ejecutada o cancelada.';
  
  const result = await executeCreateOrder(companyId, userId, action.actionData);
  await secretariaSafety.confirmPendingAction(action.id);
  
  return result.formatted;
}
```

### Cambio en safety.ts: getPendingActionById()

```typescript
async getPendingActionById(actionId: string): Promise<PendingAction | null> {
  const result = await pool.query(
    `SELECT * FROM secretaria_pending_actions WHERE id = $1 AND expires_at > NOW()`,
    [actionId]
  );
  // ... parse and return
}
```

### Cambio en system prompt: instrucciones para Claude

Agregar al system prompt:
```
FLUJO DE ESCRITURA OBLIGATORIO:
1. SIEMPRE usa preview_X antes de ejecutar_X
2. Muestra el preview al usuario con todos los datos calculados
3. Espera confirmacion explicita ("si", "dale", "confirmo")
4. Solo entonces llama a ejecutar_X con el preview_id
5. NUNCA llames a ejecutar_X sin preview previo
6. Si el usuario pide cambios, genera un NUEVO preview
```

## Archivos a modificar
| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `secretaria.v3.ts` | Reemplazar 3 write tools por 6 (3 preview + 3 ejecutar) | Alta |
| `secretaria.safety.ts` | +getPendingActionById() | Baja |
| `secretaria.executor.ts` | Adaptar para recibir datos de pendingAction | Media |
| `secretaria.validators.ts` | Sin cambios (ya valida) | Ninguna |

## Verificacion
1. "Haceme un pedido para Garcia" → preview con datos completos → "si" → pedido creado
2. "Haceme un pedido" → preview → "no" → cancelado limpiamente
3. "Haceme un pedido" → preview → "cambiame el precio a $15.000" → nuevo preview
4. "Haceme un pedido" → preview → esperar 6 min → "si" → "preview expiro"
5. Intentar ejecutar_pedido sin preview → rechazado
6. Intentar ejecutar_pedido con preview_id inventado → rechazado

## Dependencia
- Funciona mejor con Plan 8 (working memory) pero es independiente
- Se beneficia de Plan 6 (historial completo) para que Claude recuerde el preview
