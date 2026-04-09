# Plan 11 — Fase 5d: Referencias Cruzadas Auto + Datos Receptor

## Objetivo
Auto-llenar los campos de referencia (Factura N°, Pedido N°) y datos del receptor (razon social, domicilio, CUIT, condicion IVA) cuando se selecciona empresa.

## Archivo: frontend/src/pages/Remitos.tsx

## Cambio 1: Datos del receptor auto-fill

Cuando el usuario selecciona una empresa en EnterpriseCustomerSelector, cargar los datos de esa empresa y pre-llenar:

```typescript
const selectedEnterprise = enterprises.find(e => e.id === form.enterprise_id);
// Pre-llenar delivery_address con la direccion de la empresa si esta vacio
useEffect(() => {
  if (form.enterprise_id && !form.delivery_address) {
    const ent = enterprises.find(e => e.id === form.enterprise_id);
    if (ent?.address) {
      setForm(prev => ({ ...prev, delivery_address: ent.address }));
    }
  }
}, [form.enterprise_id]);
```

## Cambio 2: Referencias cruzadas auto-calculadas

Agregar campos calculados que se llenan auto basados en los items:

```typescript
const autoPedidoRef = useMemo(() => {
  const orderRefs = [...new Set(items
    .filter(i => i.source === 'order' && i.source_ref)
    .map(i => i.source_ref)
  )];
  return orderRefs.join(', ');
}, [items]);

const autoFacturaRef = useMemo(() => {
  const invoiceRefs = [...new Set(items
    .filter(i => i.source === 'invoice' && i.source_ref)
    .map(i => i.source_ref)
  )];
  return invoiceRefs.join(', ');
}, [items]);
```

## Cambio 3: Mostrar las referencias en el form

Agregar seccion entre items y notas:

```tsx
{(autoPedidoRef || autoFacturaRef) && (
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label>Pedido(s) vinculado(s)</label>
      <Input value={autoPedidoRef} disabled className="bg-gray-50" />
    </div>
    <div>
      <label>Factura(s) vinculada(s)</label>
      <Input value={autoFacturaRef} disabled className="bg-gray-50" />
    </div>
  </div>
)}
```

## Cambio 4: Incluir en payload

```typescript
const payload = {
  ...form,
  pedido_ref: autoPedidoRef || null,
  factura_ref: autoFacturaRef || null,
  items: ...
};
```

## Verificacion
- Seleccionar empresa → direccion se pre-llena
- Importar items de pedido → "Pedido(s) vinculado(s)" muestra "#0003"
- Importar items de pedido + factura → ambas referencias se muestran
- Multi-pedido → "Pedido #0003, Pedido #0005"
- Las referencias se envian en el payload

## Complejidad: Baja
