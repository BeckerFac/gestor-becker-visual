# Plan de Testing por Secciones — Endpoints

## Metodologia
Cada test simula una llamada HTTP al service layer con DB mockeada.
- Mockeo `pool.query` / `db.execute` / `pool.connect`
- Invoco el metodo del service (lo que hace el controller)
- Verifico: SQL queries ejecutadas, parametros, resultado final

## SECCION 1 — Crear Pedidos

### T1.1: Crear pedido simple con 2 items
**Endpoint**: `POST /api/orders`
**Body**:
```json
{
  "title": "Pedido A-1",
  "enterprise_id": "ent-a",
  "items": [
    { "product_id": "prod-pintura", "product_name": "Pintura 20L", "quantity": 10, "unit_price": 10000, "vat_rate": 21 },
    { "product_id": "prod-servicio", "product_name": "Servicio Consultoria", "quantity": 2, "unit_price": 50000, "vat_rate": 21 }
  ]
}
```
**Verificar**:
- BEGIN transaction
- INSERT INTO orders con todos los campos
- INSERT INTO order_items x2 (product_name, quantity, unit_price, vat_rate)
- Total calculado correctamente: (10×10000 + 2×50000) + IVA 21% = 242.000
- Return: `{ id, order_number: 1, total_amount, status: 'pendiente' }`

### T1.2: Crear pedido para misma empresa
**Endpoint**: `POST /api/orders`
**Body**: enterprise_id=ent-a, items=[Pintura x5]
**Verificar**:
- Numero secuencial 2
- Total = 60.500

### T1.3: Crear pedido para otra empresa
**Endpoint**: `POST /api/orders`
**Body**: enterprise_id=ent-b, items=[Pintura x3]
**Verificar**:
- Numero secuencial 3
- Enterprise_id diferente al de T1.1/T1.2
- Total = 36.300

## SECCION 2 — Remitos basico
### T2.1: Importar pedido → Crear remito
### T2.2: Remito parcial
### T2.3: Stock no se movio

## SECCION 3 — Item manual + stock
### T3.1: Manual con producto (stock control)
### T3.2: Manual sin producto (texto libre)

## SECCION 4 — Multi-pedido
### T4.1: 2 pedidos misma empresa
### T4.2: Mezclar empresas (rechazo)

## SECCION 5 — Desde factura
### T5.1: Crear factura
### T5.2: Resolver invoice items

## SECCION 6 — Expandible + context menu
## SECCION 7 — PDF
## SECCION 8 — Anular remito
## SECCION 9 — Facturacion independiente
## SECCION 10 — Edge cases
## SECCION 11 — Network verification
## SECCION 12 — Checklist final
