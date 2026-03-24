# Plan de Sprints - GESTIA 2026-03-24

## Sprint 1: Blockers (Orden optimizado)

### Fase A (paralelo - cambios independientes)
- 1.1.1: Migrar getPendingInvoices() a cobro_invoice_applications
- 1.1.3: Migrar getSummary() a cobro_invoice_applications
- 1.1.4: Migrar queryClients() en secretaria.tools.ts
- 1.3.1: Remover || true de feature gate SecretarIA
- 1.4.1: Documentar MercadoPago IDs pendientes
- 1.6.1: Diagnosticar y fix re-renders PipelineKanban

### Fase B (secuencial - dependen entre si)
- 1.1.2: Reescribir registerPayment() para crear cobro + application
- 1.2.1: Transaccion SQL en createCobro()
- 1.2.2: Transaccion SQL en deleteCobro()

### Fase C (paralelo con Fase B)
- 1.2.3: Transaccion SQL en createPago()
- 1.2.4: Transaccion SQL en deletePago()
- 1.2.5: Transaccion SQL en createInvoice()
- 1.2.6: Transaccion SQL en createOrder()/updateOrder()

### Fase D (despues de Fase B)
- 1.5.1: Eliminar path legacy en createCobro
- 1.5.2: Eliminar path legacy en deleteCobro
- 1.5.3: Deprecar recalculateOrderPaymentStatus

## Sprint 2: Production-ready
- 2.1.1-2.1.5: NC/ND normales (A/B/C)
- 2.2.1: Fix SELECT * en export
- 2.3.1: Verificar FK constraints
- 2.4.1: Verificar Libro IVA formato ARCA

## Sprint 3: Competitivo
- 3.1.1-3.1.4: Retenciones automaticas
- 3.2.1-3.2.4: Conciliacion bancaria
- 3.3.1-3.3.3: Multimoneda

## Sprint 4: Diferenciacion
- 4.1.1-4.1.2: WSFEX exportacion
- 4.2.1-4.2.2: Contabilidad automatica
- 4.3.1-4.3.2: Landing + onboarding
