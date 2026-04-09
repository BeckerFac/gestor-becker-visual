# Plan 11: Indice General — Vinculacion Pedidos ↔ Remitos ↔ Facturas

## Resumen del cambio
Los remitos pasan de ser documentos planos a documentos vinculados item por item con pedidos y facturas. Esto habilita:
- Facturar desde remitos (total/parcial)
- Remitar desde facturas (total/parcial)
- Tracking de entrega por item
- Remitos multi-pedido (misma empresa)
- Bloqueo de items remitados al facturar directo desde pedido

## Regla fundamental
Un item de pedido puede ser FACTURADO y/o REMITADO de forma independiente:
- Si fue remitado → se factura DESDE el remito
- Si fue facturado → se remita DESDE la factura
- Si no fue ni facturado ni remitado → se puede hacer cualquiera de los dos

## Fases de implementacion

| Fase | Archivo del plan | Que hace | Complejidad |
|------|-----------------|----------|-------------|
| 1 | plan-11-fase-1-migraciones-db.md | 7 migraciones DB: tablas nuevas + columnas | Baja |
| 2 | plan-11-fase-2-backend-queries.md | 5 queries de disponibilidad (items para remitar/facturar) | Media |
| 3 | plan-11-fase-3-backend-create-remito.md | Reescribir createRemito con vinculos item por item | Alta |
| 4 | plan-11-fase-4-backend-factura-remito.md | Factura desde remito + bloqueo de remitados al facturar pedido | Alta |
| 5 | plan-11-fase-5-frontend-remitos.md | Reescribir item picker de remitos (importar pedido + factura) | Alta |
| 6 | plan-11-fase-6-frontend-remitos-context.md | Context menu + expandible + status por item en remitos | Media |
| 7 | plan-11-fase-7-frontend-facturas.md | RemitoItemsImporter + bloqueo items remitados en OrderItemsImporter | Alta |
| 8 | plan-11-fase-8-frontend-pedidos.md | Context menu con remitos + expandible con qty_delivered | Media |
| 9 | plan-11-fase-9-pdf-testing.md | PDF formato real + testing E2E de los 6 flujos | Alta |

## Dependencias entre fases
```
Fase 1 (DB) ──────┬──→ Fase 2 (Queries) ──→ Fase 3 (createRemito)
                   │                          ↓
                   │                     Fase 4 (Factura↔Remito)
                   │                          ↓
                   ├──→ Fase 5 (FE Remitos picker) ──→ Fase 6 (FE Remitos context)
                   │                                        ↓
                   └──→ Fase 7 (FE Facturas importer) ──→ Fase 8 (FE Pedidos)
                                                              ↓
                                                         Fase 9 (PDF + Testing)
```

Fases 2-4 (backend) pueden hacerse en paralelo con Fases 5-8 (frontend) si se mockean los endpoints.

## Contadores criticos (referencia rapida)
```
order_item.quantity        = 10 (total pedido)
qty_invoiced              = SUM(invoice_items.qty WHERE order_item_id = este)
qty_delivered             = SUM(remito_items.qty WHERE order_item_id = este)
qty_invoiced_via_remito   = SUM(invoice_items.qty WHERE remito_item_id.order_item_id = este)

qty_facturar_directo      = quantity - qty_invoiced - (qty_delivered - qty_invoiced_via_remito)
qty_remitar               = quantity - qty_delivered
qty_remito_sin_facturar   = qty_delivered - qty_invoiced_via_remito
```

---

## CORRECCIONES POST-REVIEW (19 issues resueltos)

### Issues CRITICAL resueltos:
- **C1**: Cancelar factura limpia invoice_remitos (Fase 4)
- **C2**: Edicion de items vinculados PROHIBIDA, solo cancelar+recrear (Fase 3)
- **C3**: Validaciones dentro de transaccion con SELECT FOR UPDATE (Fase 3)
- **C4**: Funcion recalculateQtyDelivered como safety net (Fase 3)

### Issues HIGH resueltos:
- **H1**: Endpoint getInvoicesWithPendingDelivery agregado (Fase 4)
- **H2**: company_id filtering en Query 3 (Fase 4)
- **H3**: Validacion misma empresa al crear remito desde factura (Fase 3)
- **H4**: qty_delivered transitivo invoice_item→order_item (Fase 3)
- **H5**: Validacion qty_delivered + new_qty <= quantity (Fase 3)
- **H6**: ON DELETE RESTRICT en tablas N:N (Fase 1)

### Issues MEDIUM resueltos:
- **M1**: getInvoiceContextData definido en Fase 7
- **M2**: pedido_ref/factura_ref cambiado a TEXT (Fase 1)
- **M3**: Documentado que el status de facturacion del remito se calcula on-the-fly
- **M4**: Dependencias corregidas en diagrama (frontend depende de backend, no es paralelo)
- **M5**: Remitos legacy se muestran sin origen y sin columnas de facturacion

### Issues LOW resueltos:
- **L1**: Indices parciales en columnas de vinculo (Fase 1)
- **L2**: Query de getRemitosWithPendingItems corregida (Fase 4)
- **L3**: Test 4 actualizado para verificar qty_delivered transitivo (Fase 9)
- **L4**: Permisos: mismos roles que pedidos/facturas (sin cambio adicional)

### Dependencias corregidas:
```
Fase 1 (DB) → Fase 2 (Queries) → Fase 3 (createRemito) → Fase 4 (Factura↔Remito)
                                                              ↓
Fase 5 (FE Remitos) → Fase 6 (FE Remitos context)
                                  ↓
Fase 7 (FE Facturas) → Fase 8 (FE Pedidos) → Fase 9 (PDF + Testing)
```
Todas secuenciales. No hay paralelismo.
