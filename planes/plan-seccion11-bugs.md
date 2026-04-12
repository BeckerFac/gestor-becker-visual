# SECCION 11 — Bugs sistemicos cross-module

## Hallazgo CRITICO
**34 ocurrencias** de `status != 'cancelled'` (solo ingles) en **13 modulos del backend**.

Todos los modulos financieros calculan wrong si una factura se cancelo con status 'cancelado' (espanol).

## Modulos afectados
1. `orders.service.ts` — invoiced_amount wrong
2. `invoices.service.ts` — getAvailableOrderItemsForInvoicing
3. `crm.service.ts` — enterprise stats
4. `purchases.service.ts` — status sin_facturar/facturado wrong
5. `purchase-invoices.service.ts` — purchase item availability
6. `cuenta-corriente.service.ts` — saldos enterprise wrong (5 lugares)
7. `cobros.service.ts` — cobro availability
8. `cobro-applications.service.ts` — invoice applications
9. `pagos.service.ts` — pago availability
10. `pago-applications.service.ts` — purchase invoice applications
11. `collections.service.ts` — collections list
12. `reports.service.ts` — libro IVA, ventas reports
13. `secretaria.v3.ts` — AI agent availability

## Fix pattern
`i.status != 'cancelled'` → `i.status NOT IN ('cancelled', 'cancelado')`

## Frontend bugs
14. `Remitos.tsx:318` — `i.status !== 'cancelled'` (frontend filter)

## Impacto
- Saldos cuenta corriente wrong
- Libro IVA no refleja cancelaciones correctamente
- Orders show "facturado" even if invoice is cancelada
- CRM enterprise metrics off
- SecretarIA AI gives wrong data

## Strategy
Global fix: sed-replace `!= 'cancelled'` → `NOT IN ('cancelled', 'cancelado')` en cada archivo, uno por uno, con verificacion.
