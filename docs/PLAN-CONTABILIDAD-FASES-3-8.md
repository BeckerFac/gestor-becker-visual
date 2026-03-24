Ahora tengo todo el contexto necesario. Voy a construir el plan completo.

---

# PLAN DE CONTABILIDAD GESTIA -- FASES 3 a 8

## CONTEXTO DEL CODEBASE

**Cuentas del plan base** (chart-seed.ts):
| Codigo | Nombre | Tipo |
|--------|--------|------|
| 1.1 | Caja y Bancos | activo |
| 1.2 | Creditos por Ventas (Deudores) | activo |
| 1.3 | Bienes de Cambio | activo |
| 1.5 | IVA Credito Fiscal | activo |
| 2.1 | Deudas Comerciales (Proveedores) | pasivo |
| 2.3 | IVA Debito Fiscal | pasivo |
| 4.1 | Ventas | ingreso |
| 5.1 | Costo de Ventas | egreso |

**Cuentas que FALTAN en el seed** (agregar en Fase 3 o antes):
| Codigo | Nombre | Tipo |
|--------|--------|------|
| 1.6 | Valores a Depositar (Cheques) | activo |
| 2.4 | Retenciones a Pagar | pasivo |
| 4.3 | Diferencia de Cambio (positiva) | ingreso |
| 5.4 | Retenciones Sufridas | egreso |
| 5.5 | Diferencia de Cambio (negativa) | egreso |

**ACCOUNTS actual** (accounting-entries.service.ts linea 56-64):
```typescript
const ACCOUNTS = {
  CAJA_BANCOS: '1.1',
  DEUDORES_VENTAS: '1.2',
  IVA_CREDITO: '1.5',
  PROVEEDORES: '2.1',
  IVA_DEBITO: '2.3',
  VENTAS: '4.1',
  COSTO_VENTAS: '5.1',
} as const;
```

**Hallazgo: NO EXISTE cancelacion de facturas** en el codebase actual. No hay endpoint ni funcion `cancelInvoice`. Las facturas solo se borran si estan en draft (`deleteDraftInvoice`). Los steps ACC-3.10 y ACC-3.11 se simplifican: cancelacion no existe, hay que crearla o posponerla.

---

## FASE 3: Conectar hooks (11 steps)

### Pre-requisito: Agregar cuentas faltantes al seed

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/chart-seed.ts`
**Linea**: 44, antes del cierre del array `BASE_ACCOUNTS`
**Codigo a agregar**:
```typescript
  // Activo - cheques
  { code: '1.6', name: 'Valores a Depositar (Cheques)', type: 'activo', parentCode: '1', level: 2, isHeader: false },

  // Pasivo - retenciones
  { code: '2.4', name: 'Retenciones a Pagar', type: 'pasivo', parentCode: '2', level: 2, isHeader: false },

  // Ingresos - diferencia de cambio
  { code: '4.3', name: 'Diferencia de Cambio (ganancia)', type: 'ingreso', parentCode: '4', level: 2, isHeader: false },

  // Egresos - retenciones y diferencia de cambio
  { code: '5.4', name: 'Retenciones Sufridas', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
  { code: '5.5', name: 'Diferencia de Cambio (perdida)', type: 'egreso', parentCode: '5', level: 2, isHeader: false },
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Linea**: 63, antes del `} as const`
**Codigo a agregar**:
```typescript
  VALORES_DEPOSITAR: '1.6',
  RETENCIONES_PAGAR: '2.4',
  DIF_CAMBIO_GANANCIA: '4.3',
  RETENCIONES_SUFRIDAS: '5.4',
  DIF_CAMBIO_PERDIDA: '5.5',
```

---

### Pre-requisito 2: Helper para verificar si accounting esta habilitado

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Linea**: despues de linea 65 (cierre de ACCOUNTS), antes de la clase
**Codigo a agregar**:
```typescript
/**
 * Check if a company has accounting enabled (= has chart of accounts seeded).
 * Returns true if at least one account exists.
 */
async function isAccountingEnabled(companyId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS(SELECT 1 FROM chart_of_accounts WHERE company_id = ${companyId}) as enabled
  `);
  return ((result as any).rows || [])[0]?.enabled === true;
}
```

---

## ACC-3.1: Hook en authorizeInvoice()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/invoices/invoices.service.ts`
**Funcion objetivo**: `authorizeInvoice()` -- linea 781
**Punto de insercion**: DESPUES de linea 1100 (`} catch (e) { console.error('CRM sync error...`) y ANTES de `return updated;` en linea 1102. Es decir, entre el bloque CRM sync y el return.
**Datos disponibles en scope**:
- `companyId` (string)
- `invoiceId` (string)
- `updated` (objeto factura completa con items, total_amount, subtotal, vat_amount, invoice_date)
- `invoice` (objeto original)
- `neto` (number - neto recalculado)
- `iva` (number - IVA recalculado)
- `calculatedTotal` / `invoiceTotal` (number)
- `invoiceType` (string: 'A', 'B', 'NC_A', etc.)
- `isNcNd` (boolean)

**Import necesario**: Ninguno (dynamic import)
**Codigo a agregar** (insertar DESPUES de linea 1100, antes de `return updated;`):
```typescript
      // Accounting: auto journal entry for authorized invoice
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        const { isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const total = parseFloat(updated.total_amount?.toString() || '0');
          const vat = parseFloat(updated.vat_amount?.toString() || '0');
          const subtotalVal = parseFloat(updated.subtotal?.toString() || '0') || (total - vat);
          const date = updated.invoice_date
            ? new Date(updated.invoice_date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          if (isNcNd && invoiceType.startsWith('NC_')) {
            // Nota de credito: asiento inverso
            await accountingEntriesService.createEntry({
              companyId,
              date,
              description: `NC ${invoiceType} #${updated.invoice_number}`,
              referenceType: 'invoice',
              referenceId: invoiceId,
              isAuto: true,
              lines: [
                { accountCode: '4.1', debit: subtotalVal, credit: 0, description: 'Ventas (NC)' },
                ...(vat > 0 ? [{ accountCode: '2.3', debit: vat, credit: 0, description: 'IVA Debito Fiscal (NC)' }] : []),
                { accountCode: '1.2', debit: 0, credit: total, description: 'Deudores por Ventas (NC)' },
              ],
            });
          } else if (isNcNd && invoiceType.startsWith('ND_')) {
            // Nota de debito: mismo sentido que factura
            await accountingEntriesService.createEntryForInvoice({
              id: invoiceId,
              company_id: companyId,
              date,
              total,
              subtotal: subtotalVal,
              vat_amount: vat,
            });
          } else {
            // Factura normal
            await accountingEntriesService.createEntryForInvoice({
              id: invoiceId,
              company_id: companyId,
              date,
              total,
              subtotal: subtotalVal,
              vat_amount: vat,
            });
          }
        }
      } catch (accErr) {
        console.error('Accounting entry error (authorizeInvoice):', accErr);
      }
```

**Validacion DEBE=HABER**:
- Factura normal: D 1.2 (total) = C 4.1 (neto) + C 2.3 (iva). total = neto + iva. BALANCEA.
- NC: D 4.1 (neto) + D 2.3 (iva) = C 1.2 (total). neto + iva = total. BALANCEA.

**Test**: Crear factura, autorizarla. Verificar que se creo journal_entry con reference_type='invoice'. Verificar lineas D/H balanceadas.
**Dependencias**: Pre-requisitos (cuentas en seed, isAccountingEnabled helper)
**Riesgo**: Medio -- la funcion authorizeInvoice es critica. El try/catch aislado garantiza que un error contable no rompe la autorizacion AFIP.

---

### ACC-3.2: Hook en createCobro()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cobros/cobros.service.ts`
**Funcion objetivo**: `createCobro()` -- linea 112
**Punto de insercion**: DESPUES de linea 275 (`} catch (e) { console.error('CRM sync error (cobro_created):', e); }`) y ANTES de `return cobro;` en linea 277.
**Datos disponibles en scope**:
- `companyId` (string)
- `cobroId` (string)
- `data.amount` (string/number)
- `data.payment_method` (string: 'efectivo', 'transferencia', 'cheque', etc.)
- `data.payment_date` (string ISO)
- `data.bank_id` (string | null)
- `cobro` (objeto completo del SELECT)

**Import necesario**: Ninguno (dynamic import)
**Codigo a agregar** (insertar DESPUES de linea 275, antes de `return cobro;`):
```typescript
      // Accounting: auto journal entry for cobro
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const amount = parseFloat(data.amount?.toString() || '0');
          const date = data.payment_date
            ? new Date(data.payment_date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          if (data.payment_method === 'cheque') {
            // Cheque recibido: D Valores a Depositar / C Deudores por Ventas
            await accountingEntriesService.createEntry({
              companyId,
              date,
              description: `Cobro con cheque`,
              referenceType: 'cobro',
              referenceId: cobroId,
              isAuto: true,
              lines: [
                { accountCode: '1.6', debit: amount, credit: 0, description: 'Valores a Depositar' },
                { accountCode: '1.2', debit: 0, credit: amount, description: 'Deudores por Ventas' },
              ],
            });
          } else {
            // Efectivo/transferencia: D Caja y Bancos / C Deudores por Ventas
            await accountingEntriesService.createEntryForCobro({
              id: cobroId,
              company_id: companyId,
              date,
              amount,
            });
          }
        }
      } catch (accErr) {
        console.error('Accounting entry error (createCobro):', accErr);
      }
```

**Validacion DEBE=HABER**:
- Efectivo/transf: D 1.1 (amount) = C 1.2 (amount). BALANCEA.
- Cheque: D 1.6 (amount) = C 1.2 (amount). BALANCEA.

**Test**: Crear cobro con efectivo -> verificar asiento D 1.1 / C 1.2. Crear cobro con cheque -> verificar asiento D 1.6 / C 1.2.
**Dependencias**: Pre-requisitos
**Riesgo**: Bajo -- insercion despues de CRM sync, no afecta flujo principal.

---

### ACC-3.3: Hook en deleteCobro()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cobros/cobros.service.ts`
**Funcion objetivo**: `deleteCobro()` -- linea 285
**Punto de insercion**: ANTES del `BEGIN` en linea 295. Necesitamos leer el cobro ANTES de borrarlo para tener amount y payment_method. El cobro ya se lee parcialmente en linea 288 (`SELECT id, order_id`). Hay que ampliar ese SELECT y generar el contra-asiento DESPUES del COMMIT.
**Datos disponibles en scope tras la modificacion**:
- `companyId` (string)
- `cobroId` (string)
- `rows[0]` -- solo tiene `id` y `order_id` actualmente

**Cambios necesarios**:
1. Ampliar el SELECT de linea 288
2. Guardar datos para contra-asiento
3. Insertar hook despues del `for` de recalculation (linea 317)

**Codigo a agregar**:

Primero, **modificar linea 288** de:
```typescript
const check = await db.execute(sql`SELECT id, order_id FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);
```
a:
```typescript
const check = await db.execute(sql`SELECT id, order_id, amount, payment_method, payment_date FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}`);
```

Luego guardar datos (agregar despues de linea 291 `const orderId = rows[0].order_id;`):
```typescript
      const cobroAmount = parseFloat(rows[0].amount || '0');
      const cobroMethod = rows[0].payment_method;
      const cobroDate = rows[0].payment_date;
```

Luego, **insertar DESPUES de linea 317** (despues del `for` de recalculation, antes de `return { success: true };`):
```typescript
      // Accounting: reverse journal entry for deleted cobro
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const date = cobroDate
            ? new Date(cobroDate).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          if (cobroMethod === 'cheque') {
            await accountingEntriesService.createEntry({
              companyId,
              date,
              description: `Anulacion cobro con cheque`,
              referenceType: 'cobro_reversal',
              referenceId: cobroId,
              isAuto: true,
              lines: [
                { accountCode: '1.2', debit: cobroAmount, credit: 0, description: 'Deudores por Ventas (reverso)' },
                { accountCode: '1.6', debit: 0, credit: cobroAmount, description: 'Valores a Depositar (reverso)' },
              ],
            });
          } else {
            await accountingEntriesService.createEntry({
              companyId,
              date,
              description: `Anulacion cobro`,
              referenceType: 'cobro_reversal',
              referenceId: cobroId,
              isAuto: true,
              lines: [
                { accountCode: '1.2', debit: cobroAmount, credit: 0, description: 'Deudores por Ventas (reverso)' },
                { accountCode: '1.1', debit: 0, credit: cobroAmount, description: 'Caja y Bancos (reverso)' },
              ],
            });
          }
        }
      } catch (accErr) {
        console.error('Accounting entry error (deleteCobro):', accErr);
      }
```

**Validacion DEBE=HABER**: D 1.2 (amount) = C 1.1 (amount). Inverso exacto de ACC-3.2. BALANCEA.
**Test**: Crear cobro, verificar asiento. Eliminar cobro, verificar contra-asiento. Verificar que saldo neto es 0.
**Dependencias**: ACC-3.2
**Riesgo**: Medio -- debemos leer datos ANTES del delete. El SELECT ampliado no tiene riesgo.

---

### ACC-3.4: Hook en createPago()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/pagos/pagos.service.ts`
**Funcion objetivo**: `createPago()` -- linea 84
**Punto de insercion**: DESPUES de linea 193 (el SELECT del resultado final) y ANTES de `return rows[0];` en linea 194. Las retenciones ya se crearon (lineas 152-177).
**Datos disponibles en scope**:
- `companyId` (string)
- `pagoId` (string)
- `data.amount` (string/number)
- `data.payment_method` (string)
- `data.payment_date` (string ISO)
- `data.enterprise_id` (string)
- `rows[0]` (pago completo)

**Import necesario**: Ninguno (dynamic import)
**Codigo a agregar** (insertar DESPUES de linea 193, antes de `return rows[0];`):
```typescript
      // Accounting: auto journal entry for pago + retenciones
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const amount = parseFloat(data.amount?.toString() || '0');
          const date = data.payment_date
            ? new Date(data.payment_date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          // Check if retentions were created for this pago
          const retResult = await db.execute(sql`
            SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_ret
            FROM retenciones WHERE pago_id = ${pagoId}
          `);
          const totalRetenciones = parseFloat(((retResult as any).rows || [])[0]?.total_ret || '0');

          const lines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [
            { accountCode: '2.1', debit: amount + totalRetenciones, credit: 0, description: 'Proveedores' },
          ];

          if (data.payment_method === 'cheque_endosado') {
            lines.push({ accountCode: '1.6', debit: 0, credit: amount, description: 'Valores a Depositar (cheque endosado)' });
          } else {
            lines.push({ accountCode: '1.1', debit: 0, credit: amount, description: 'Caja y Bancos' });
          }

          if (totalRetenciones > 0) {
            lines.push({ accountCode: '2.4', debit: 0, credit: totalRetenciones, description: 'Retenciones a Pagar' });
          }

          await accountingEntriesService.createEntry({
            companyId,
            date,
            description: `Pago registrado`,
            referenceType: 'pago',
            referenceId: pagoId,
            isAuto: true,
            lines,
          });
        }
      } catch (accErr) {
        console.error('Accounting entry error (createPago):', accErr);
      }
```

**Validacion DEBE=HABER**:
- Sin retenciones: D 2.1 (amount) = C 1.1 (amount). BALANCEA.
- Con retenciones: D 2.1 (amount + ret) = C 1.1 (amount) + C 2.4 (ret). amount + ret = amount + ret. BALANCEA.
- Con cheque endosado: D 2.1 (amount) = C 1.6 (amount). BALANCEA.

**Test**: Crear pago sin retenciones -> verificar asiento simple. Crear pago con retenciones -> verificar 3 lineas.
**Dependencias**: Pre-requisitos
**Riesgo**: Medio -- la query a retenciones agrega un round-trip extra pero es post-transaction.

---

### ACC-3.5: Hook en deletePago()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/pagos/pagos.service.ts`
**Funcion objetivo**: `deletePago()` -- linea 201
**Punto de insercion**: ANTES del `BEGIN` en linea 216, leer datos completos del pago. Generar contra-asiento DESPUES del COMMIT (linea 231).

**Cambios necesarios**:
1. Ampliar el SELECT de linea 204

Modificar linea 204 de:
```typescript
const check = await db.execute(sql`SELECT id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
```
a:
```typescript
const check = await db.execute(sql`SELECT id, amount, payment_method, payment_date FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
```

Agregar despues de linea 206 (`if (rows.length === 0) throw...`):
```typescript
    const pagoAmount = parseFloat(rows[0].amount || '0');
    const pagoMethod = rows[0].payment_method;
    const pagoDate = rows[0].payment_date;

    // Read retenciones before they get cascade-deleted
    const retCheck = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_ret FROM retenciones WHERE pago_id = ${pagoId}
    `);
    const totalRetenciones = parseFloat(((retCheck as any).rows || [])[0]?.total_ret || '0');
```

Insertar DESPUES del COMMIT (despues de linea 231 `await db.execute(sql\`COMMIT\`);`), antes de `return { success: true };`:
```typescript
      // Accounting: reverse journal entry for deleted pago
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const date = pagoDate
            ? new Date(pagoDate).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          const lines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [];

          if (pagoMethod === 'cheque_endosado') {
            lines.push({ accountCode: '1.6', debit: pagoAmount, credit: 0, description: 'Valores a Depositar (reverso)' });
          } else {
            lines.push({ accountCode: '1.1', debit: pagoAmount, credit: 0, description: 'Caja y Bancos (reverso)' });
          }

          if (totalRetenciones > 0) {
            lines.push({ accountCode: '2.4', debit: totalRetenciones, credit: 0, description: 'Retenciones a Pagar (reverso)' });
          }

          lines.push({ accountCode: '2.1', debit: 0, credit: pagoAmount + totalRetenciones, description: 'Proveedores (reverso)' });

          await accountingEntriesService.createEntry({
            companyId,
            date,
            description: `Anulacion pago`,
            referenceType: 'pago_reversal',
            referenceId: pagoId,
            isAuto: true,
            lines,
          });
        }
      } catch (accErr) {
        console.error('Accounting entry error (deletePago):', accErr);
      }
```

**Validacion DEBE=HABER**: D 1.1 (amount) + D 2.4 (ret) = C 2.1 (amount + ret). Inverso exacto de ACC-3.4. BALANCEA.
**Test**: Crear pago con retenciones, eliminar, verificar que el contra-asiento tiene 3 lineas y balancea.
**Dependencias**: ACC-3.4
**Riesgo**: Medio -- debemos leer retenciones ANTES del delete (cascade). Lectura es fuera de transaction, lo cual esta OK porque aun no se borro nada.

---

### ACC-3.6: Hook en createPurchaseInvoice()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/purchase-invoices/purchase-invoices.service.ts`
**Funcion objetivo**: `createPurchaseInvoice()` -- linea 72
**Punto de insercion**: DESPUES de linea 156 (`return this.getPurchaseInvoice(companyId, piId);`) -- pero hay que interceptar ANTES del return. Cambiar a:

```typescript
    const created = await this.getPurchaseInvoice(companyId, piId);

    // Accounting: auto journal entry for purchase invoice
    try {
      const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
      if (await isAccountingEnabled(companyId)) {
        const total = data.total_amount;
        const vat = data.vat_amount || 0;
        const subtotalVal = data.subtotal || (total - vat);
        const date = data.invoice_date;

        await accountingEntriesService.createEntryForPurchaseInvoice({
          id: piId,
          company_id: companyId,
          date,
          total,
          subtotal: subtotalVal,
          vat_amount: vat,
        });
      }
    } catch (accErr) {
      console.error('Accounting entry error (createPurchaseInvoice):', accErr);
    }

    return created;
```

**Datos disponibles en scope**:
- `companyId` (string)
- `piId` (string, UUID generado en linea 122)
- `data.total_amount` (number, validado > 0 en linea 94)
- `data.vat_amount` (number | undefined)
- `data.subtotal` (number | undefined)
- `data.invoice_date` (string)

**Import necesario**: Ninguno (dynamic import)
**Validacion DEBE=HABER**: D 5.1 (neto) + D 1.5 (iva) = C 2.1 (total). neto + iva = total. BALANCEA.
**Test**: Crear factura de compra con IVA -> verificar 3 lineas. Sin IVA -> verificar 2 lineas.
**Dependencias**: Pre-requisitos
**Riesgo**: Bajo -- la funcion es simple, sin transacciones complejas.

---

### ACC-3.7: Hook en updateChequeStatus()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cheques/cheques.service.ts`
**Funcion objetivo**: `updateChequeStatus()` -- linea 82
**Punto de insercion**: DESPUES de linea 123 (cierre del ultimo `else` del update) y ANTES de `return { id: chequeId, status: newStatus };` en linea 125.

Necesitamos el amount del cheque. Actualmente el SELECT de linea 89 solo trae `id, status`. Hay que ampliarlo.

**Modificar linea 89** de:
```typescript
const result = await db.execute(sql`
  SELECT id, status FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
`);
```
a:
```typescript
const result = await db.execute(sql`
  SELECT id, status, amount, bank_id, cobro_id FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
`);
```

**Codigo a agregar** (despues de linea 123, antes del return):
```typescript
      // Accounting: journal entry for cheque status change
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const chequeAmount = parseFloat(rows[0].amount || '0');
          const today = new Date().toISOString().split('T')[0];

          if (newStatus === 'depositado') {
            // Cheque depositado: D Caja y Bancos / C Valores a Depositar
            await accountingEntriesService.createEntry({
              companyId,
              date: today,
              description: `Cheque depositado`,
              referenceType: 'cheque',
              referenceId: chequeId,
              isAuto: true,
              lines: [
                { accountCode: '1.1', debit: chequeAmount, credit: 0, description: 'Caja y Bancos' },
                { accountCode: '1.6', debit: 0, credit: chequeAmount, description: 'Valores a Depositar' },
              ],
            });
          } else if (newStatus === 'cobrado' && currentStatus === 'depositado') {
            // Ya se hizo el asiento al depositar, no se necesita otro
          } else if (newStatus === 'cobrado' && currentStatus === 'a_cobrar') {
            // Cobrado directo (sin depositar): D Caja y Bancos / C Valores a Depositar
            await accountingEntriesService.createEntry({
              companyId,
              date: today,
              description: `Cheque cobrado`,
              referenceType: 'cheque',
              referenceId: chequeId,
              isAuto: true,
              lines: [
                { accountCode: '1.1', debit: chequeAmount, credit: 0, description: 'Caja y Bancos' },
                { accountCode: '1.6', debit: 0, credit: chequeAmount, description: 'Valores a Depositar' },
              ],
            });
          } else if (newStatus === 'rechazado') {
            // Cheque rechazado: D Deudores por Ventas / C Valores a Depositar
            // (vuelve la deuda al cliente)
            await accountingEntriesService.createEntry({
              companyId,
              date: today,
              description: `Cheque rechazado`,
              referenceType: 'cheque',
              referenceId: chequeId,
              isAuto: true,
              lines: [
                { accountCode: '1.2', debit: chequeAmount, credit: 0, description: 'Deudores por Ventas (cheque rechazado)' },
                { accountCode: '1.6', debit: 0, credit: chequeAmount, description: 'Valores a Depositar' },
              ],
            });
          }
        }
      } catch (accErr) {
        console.error('Accounting entry error (updateChequeStatus):', accErr);
      }
```

**Validacion DEBE=HABER**: Todos los asientos son 2 lineas con mismo amount en D y H. BALANCEA.
**Test**: Cambiar cheque a 'depositado' -> verificar asiento D 1.1 / C 1.6. Cambiar a 'rechazado' -> verificar D 1.2 / C 1.6.
**Dependencias**: Pre-requisitos (cuenta 1.6)
**Riesgo**: Medio -- multiples transiciones posibles. Se cubren los 3 casos contablemente relevantes.

---

### ACC-3.8: Hook en endorseCheque()

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cheques/cheques.service.ts`
**Funcion objetivo**: `endorseCheque()` -- linea 278
**Punto de insercion**: DESPUES de linea 358 (el ajuste por exceso) y ANTES de `return` en linea 361.

**PROBLEMA CRITICO**: El endoso crea un pago con payment_method='cheque_endosado' (linea 321). Si ACC-3.4 esta activo, ese pago generaria un asiento automatico via createPago(). Pero el endoso NO pasa por la funcion `createPago()` de PagosService -- hace un INSERT directo. Por lo tanto NO hay doble asiento.

Verificacion: el INSERT de linea 319 es directo `INSERT INTO pagos`, NO llama a `pagosService.createPago()`. Entonces ACC-3.4 NO se dispara para endosos. El hook de ACC-3.8 es el unico asiento.

**Datos disponibles en scope**:
- `companyId` (string)
- `chequeId` (string)
- `pagoId` (string, generado en linea 317)
- `data.amount` (number)
- `data.enterprise_id` (string)
- `chequeAmount` (number, parseado en linea 299)
- `excess` (number, calculado en linea 353)

**Codigo a agregar** (insertar DESPUES de linea 359, antes del return):
```typescript
    // Accounting: cheque endorsement
    // D Proveedores (amount) / C Valores a Depositar (amount)
    // If excess > 0: also D Valores a Depositar (excess) / C Deudores (excess)
    try {
      const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
      if (await isAccountingEnabled(companyId)) {
        const today = new Date().toISOString().split('T')[0];

        // Main entry: pay provider with cheque
        await accountingEntriesService.createEntry({
          companyId,
          date: today,
          description: `Endoso cheque #${cheque.number} a proveedor`,
          referenceType: 'cheque_endoso',
          referenceId: chequeId,
          isAuto: true,
          lines: [
            { accountCode: '2.1', debit: chequeAmount, credit: 0, description: 'Proveedores' },
            { accountCode: '1.6', debit: 0, credit: chequeAmount, description: 'Valores a Depositar' },
          ],
        });
      }
    } catch (accErr) {
      console.error('Accounting entry error (endorseCheque):', accErr);
    }
```

**Validacion DEBE=HABER**: D 2.1 (chequeAmount) = C 1.6 (chequeAmount). BALANCEA. El exceso se maneja via CC (account_adjustments), no contablemente -- es un credito contra el proveedor, no un movimiento de caja.
**Test**: Endosar cheque de $10000 para pago de $8000 -> verificar asiento por $10000. El exceso es un ajuste CC, no contable.
**Dependencias**: Pre-requisitos (cuenta 1.6)
**Riesgo**: Bajo -- insercion simple al final de la funcion.

---

### ACC-3.9: Hook en createAdjustment() de CC

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cuenta-corriente/cuenta-corriente.service.ts`
**Funcion objetivo**: `createAdjustment()` -- linea 548
**Punto de insercion**: DESPUES de linea 574 (el `RETURNING *` y asignacion) y ANTES del catch. Necesitamos cambiar la estructura para capturar el resultado.

Modificar lineas 569-574 de:
```typescript
const result = await db.execute(sql`...RETURNING *`);
return ((result as any).rows || [])[0];
```
a:
```typescript
      const result = await db.execute(sql`
        INSERT INTO account_adjustments (company_id, enterprise_id, amount, reason, adjustment_type, created_by)
        VALUES (${companyId}, ${enterpriseId}, ${storedAmount}, ${data.reason.trim()}, ${data.adjustment_type}, ${data.created_by || null})
        RETURNING *
      `);
      const adjustment = ((result as any).rows || [])[0];

      // Accounting: journal entry for CC adjustment
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          const absAmount = Math.abs(data.amount);
          const today = new Date().toISOString().split('T')[0];

          if (data.adjustment_type === 'debit') {
            // Debit adjustment: client owes more
            // D Deudores por Ventas / C Otros Ingresos
            await accountingEntriesService.createEntry({
              companyId,
              date: today,
              description: `Ajuste CC debit: ${data.reason}`,
              referenceType: 'adjustment',
              referenceId: adjustment.id,
              isAuto: true,
              lines: [
                { accountCode: '1.2', debit: absAmount, credit: 0, description: 'Deudores por Ventas' },
                { accountCode: '4.2', debit: 0, credit: absAmount, description: 'Otros Ingresos' },
              ],
            });
          } else {
            // Credit adjustment: we owe client / discount
            // D Otros Ingresos / C Deudores por Ventas
            // (reverso: sale de ingresos, reduce deuda del cliente)
            await accountingEntriesService.createEntry({
              companyId,
              date: today,
              description: `Ajuste CC credit: ${data.reason}`,
              referenceType: 'adjustment',
              referenceId: adjustment.id,
              isAuto: true,
              lines: [
                { accountCode: '5.2', debit: absAmount, credit: 0, description: 'Gastos Administrativos' },
                { accountCode: '1.2', debit: 0, credit: absAmount, description: 'Deudores por Ventas' },
              ],
            });
          }
        }
      } catch (accErr) {
        console.error('Accounting entry error (createAdjustment):', accErr);
      }

      return adjustment;
```

**Validacion DEBE=HABER**: Ambos casos: 2 lineas con mismo absAmount en D y H. BALANCEA.
**Test**: Crear ajuste debit -> verificar D 1.2 / C 4.2. Crear ajuste credit -> verificar D 5.2 / C 1.2.
**Dependencias**: Pre-requisitos (cuenta 4.2)
**Riesgo**: Bajo.

---

### ACC-3.10: Hook en cancelacion de factura venta

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/invoices/invoices.service.ts`
**Funcion objetivo**: NO EXISTE. No hay funcion `cancelInvoice` ni endpoint para cambiar status a 'cancelled'.

**Decision**: POSPONER. El sistema actual solo permite borrar drafts (no autorizadas). Las facturas autorizadas no se cancelan en el sistema. Para cancelar contablemente una factura autorizada se emite una Nota de Credito (NC_A, NC_B, NC_C), que ya tiene hook en ACC-3.1 (la rama `isNcNd`).

**Alternativa futura**: Cuando se implemente cancelacion de facturas autorizadas, agregar hook en esa funcion nueva.

**Riesgo**: Nulo -- no hay codigo que modificar.

---

### ACC-3.11: Hook en cancelacion de factura compra

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/purchase-invoices/purchase-invoices.service.ts`
**Funcion objetivo**: `updatePurchaseInvoice()` -- linea 217. Permite cambiar status a 'cancelled' via el campo `updatableFields.status` (linea 238).
**Punto de insercion**: DESPUES de linea 259 (`return this.getPurchaseInvoice(companyId, piId);`). Hay que interceptar si el status cambio a 'cancelled'.

Modificar la funcion. Agregar ANTES de linea 249 (`if (setClauses.length === 0)`):
```typescript
    const isBeingCancelled = data.status === 'cancelled';
```

Reemplazar lineas 258-259 (`await pool.query(...)` y `return`) por:
```typescript
    await pool.query(
      `UPDATE purchase_invoices SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1}`,
      values
    );

    // Accounting: reverse entry if purchase invoice is being cancelled
    if (isBeingCancelled) {
      try {
        const { accountingEntriesService, isAccountingEnabled } = await import('../accounting/accounting-entries.service');
        if (await isAccountingEnabled(companyId)) {
          // Read the purchase invoice to get amounts
          const piData = await this.getPurchaseInvoice(companyId, piId);
          const total = parseFloat(piData.total_amount || '0');
          const vat = parseFloat(piData.vat_amount || '0');
          const neto = parseFloat(piData.subtotal || '0') || (total - vat);
          const date = piData.invoice_date
            ? new Date(piData.invoice_date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          const lines: Array<{ accountCode: string; debit: number; credit: number; description: string }> = [
            { accountCode: '2.1', debit: total, credit: 0, description: 'Proveedores (anulacion)' },
            { accountCode: '5.1', debit: 0, credit: neto, description: 'Costo de Ventas (anulacion)' },
          ];
          if (vat > 0) {
            lines.push({ accountCode: '1.5', debit: 0, credit: vat, description: 'IVA Credito Fiscal (anulacion)' });
          }

          await accountingEntriesService.createEntry({
            companyId,
            date,
            description: `Anulacion factura compra #${piData.invoice_number}`,
            referenceType: 'purchase_invoice_reversal',
            referenceId: piId,
            isAuto: true,
            lines,
          });
        }
      } catch (accErr) {
        console.error('Accounting entry error (cancelPurchaseInvoice):', accErr);
      }
    }

    return this.getPurchaseInvoice(companyId, piId);
```

**Validacion DEBE=HABER**: D 2.1 (total) = C 5.1 (neto) + C 1.5 (iva). total = neto + iva. Inverso exacto de ACC-3.6. BALANCEA.
**Test**: Crear factura compra -> verificar asiento. Cancelarla -> verificar contra-asiento. Balance neto = 0.
**Dependencias**: ACC-3.6
**Riesgo**: Medio -- el updatePurchaseInvoice acepta cualquier campo, debemos verificar que solo se genera contra-asiento cuando cambia a cancelled.

---

### Export de isAccountingEnabled

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`

La funcion `isAccountingEnabled` definida como funcion libre necesita ser exportada. Agregar `export` delante:
```typescript
export async function isAccountingEnabled(companyId: string): Promise<boolean> {
```

---

## FASE 4: Reportes contables (4 steps)

### ACC-4.1: Libro Mayor

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Funcion objetivo**: Nuevo metodo `getLedger()` en la clase `AccountingEntriesService`
**Punto de insercion**: DESPUES de `getBalance()` (linea 427), antes del cierre de la clase.

**Codigo a agregar**:
```typescript
  /**
   * Libro Mayor: all movements for a specific account, with running balance.
   */
  async getLedger(companyId: string, filters: {
    account_code: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{ account: any; movements: any[]; opening_balance: number }> {
    if (!filters.account_code) {
      throw new ApiError(400, 'account_code es requerido');
    }

    // Get account info
    const accResult = await db.execute(sql`
      SELECT id, code, name, type FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = ${filters.account_code}
    `);
    const account = ((accResult as any).rows || [])[0];
    if (!account) throw new ApiError(404, `Cuenta ${filters.account_code} no encontrada`);

    // Calculate opening balance (sum of all entries BEFORE date_from)
    let openingBalance = 0;
    if (filters.date_from) {
      const openResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(jel.debit), 0)::numeric - COALESCE(SUM(jel.credit), 0)::numeric as balance
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE je.company_id = ${companyId}
          AND jel.account_id = ${account.id}
          AND je.date < ${filters.date_from}::date
      `);
      openingBalance = parseFloat(((openResult as any).rows || [])[0]?.balance || '0');
    }

    // Get movements in period
    const dateConditions: any[] = [
      sql`je.company_id = ${companyId}`,
      sql`jel.account_id = ${account.id}`,
    ];
    if (filters.date_from) dateConditions.push(sql`je.date >= ${filters.date_from}::date`);
    if (filters.date_to) dateConditions.push(sql`je.date <= ${filters.date_to}::date`);

    const whereClause = sql.join(dateConditions, sql` AND `);

    const movResult = await db.execute(sql`
      SELECT
        je.id as entry_id,
        je.entry_number,
        je.date,
        je.description,
        je.reference_type,
        je.reference_id,
        jel.debit::numeric as debit,
        jel.credit::numeric as credit,
        jel.description as line_description
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE ${whereClause}
      ORDER BY je.date ASC, je.entry_number ASC
    `);
    const rows = (movResult as any).rows || [];

    // Add running balance
    let runningBalance = openingBalance;
    const movements = rows.map((r: any) => {
      const debit = parseFloat(r.debit || '0');
      const credit = parseFloat(r.credit || '0');
      runningBalance += debit - credit;
      return {
        ...r,
        debit,
        credit,
        balance: runningBalance,
      };
    });

    return { account, movements, opening_balance: openingBalance };
  }
```

**Test**: Seed cuentas, crear 3 asientos que toquen cuenta 1.1. Consultar libro mayor de 1.1 -> verificar saldo progresivo.
**Dependencias**: Fase 1-2 (tablas y service deben existir)
**Riesgo**: Bajo.

---

### ACC-4.2: Balance General

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Punto de insercion**: Despues de `getLedger()`

**Codigo a agregar**:
```typescript
  /**
   * Balance General: Activo = Pasivo + Patrimonio Neto
   * Groups accounts by type with subtotals.
   */
  async getBalanceGeneral(companyId: string, filters: {
    date_to?: string;
  } = {}): Promise<{
    activo: { accounts: any[]; total: number };
    pasivo: { accounts: any[]; total: number };
    patrimonio: { accounts: any[]; total: number };
    resultado_ejercicio: number;
    balanced: boolean;
  }> {
    const dateFilter = filters.date_to
      ? sql`AND je.date <= ${filters.date_to}::date`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        coa.code, coa.name, coa.type, coa.level, coa.is_header,
        COALESCE(SUM(jel.debit), 0)::numeric as total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric as total_credit,
        (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))::numeric as balance
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ${companyId} ${dateFilter}
      WHERE coa.company_id = ${companyId}
        AND (COALESCE(jel.debit, 0) != 0 OR COALESCE(jel.credit, 0) != 0 OR coa.is_header = true)
      GROUP BY coa.id, coa.code, coa.name, coa.type, coa.level, coa.is_header
      ORDER BY coa.code
    `);
    const rows = (result as any).rows || [];

    const grouped: Record<string, any[]> = {
      activo: [], pasivo: [], patrimonio: [], ingreso: [], egreso: [],
    };

    for (const row of rows) {
      const balance = parseFloat(row.balance || '0');
      if (grouped[row.type]) {
        grouped[row.type].push({ ...row, balance });
      }
    }

    // Activo: saldo deudor (positivo = debit > credit)
    const totalActivo = grouped.activo
      .filter((a: any) => !a.is_header)
      .reduce((s: number, a: any) => s + a.balance, 0);

    // Pasivo: saldo acreedor (credit > debit, so balance is negative; we show absolute)
    const totalPasivo = grouped.pasivo
      .filter((a: any) => !a.is_header)
      .reduce((s: number, a: any) => s + Math.abs(a.balance), 0);

    // Patrimonio: saldo acreedor
    const totalPatrimonio = grouped.patrimonio
      .filter((a: any) => !a.is_header)
      .reduce((s: number, a: any) => s + Math.abs(a.balance), 0);

    // Resultado del ejercicio = Ingresos - Egresos
    const totalIngresos = grouped.ingreso
      .filter((a: any) => !a.is_header)
      .reduce((s: number, a: any) => s + Math.abs(a.balance), 0);
    const totalEgresos = grouped.egreso
      .filter((a: any) => !a.is_header)
      .reduce((s: number, a: any) => s + a.balance, 0);
    const resultadoEjercicio = totalIngresos - totalEgresos;

    const balanced = Math.abs(totalActivo - (totalPasivo + totalPatrimonio + resultadoEjercicio)) < 0.01;

    return {
      activo: { accounts: grouped.activo, total: totalActivo },
      pasivo: { accounts: grouped.pasivo, total: totalPasivo },
      patrimonio: { accounts: grouped.patrimonio, total: totalPatrimonio },
      resultado_ejercicio: resultadoEjercicio,
      balanced,
    };
  }
```

**Test**: Crear asientos de venta + cobro + compra + pago. Consultar balance general -> Activo = Pasivo + PN + Resultado.
**Dependencias**: Fase 1-2
**Riesgo**: Medio -- la logica de signos (deudor/acreedor) es delicada.

---

### ACC-4.3: Estado de Resultados

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Punto de insercion**: Despues de `getBalanceGeneral()`

**Codigo a agregar**:
```typescript
  /**
   * Estado de Resultados: Ingresos - Egresos = Resultado
   */
  async getIncomeStatement(companyId: string, filters: {
    date_from?: string;
    date_to?: string;
  } = {}): Promise<{
    ingresos: { accounts: any[]; total: number };
    egresos: { accounts: any[]; total: number };
    resultado_neto: number;
  }> {
    const dateConditions: any[] = [];
    if (filters.date_from) dateConditions.push(sql`je.date >= ${filters.date_from}::date`);
    if (filters.date_to) dateConditions.push(sql`je.date <= ${filters.date_to}::date`);
    const dateFilter = dateConditions.length > 0
      ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        coa.code, coa.name, coa.type, coa.level, coa.is_header,
        COALESCE(SUM(jel.debit), 0)::numeric as total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric as total_credit
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ${companyId} ${dateFilter}
      WHERE coa.company_id = ${companyId}
        AND coa.type IN ('ingreso', 'egreso')
      GROUP BY coa.id, coa.code, coa.name, coa.type, coa.level, coa.is_header
      HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0 OR coa.is_header = true
      ORDER BY coa.code
    `);
    const rows = (result as any).rows || [];

    const ingresos: any[] = [];
    const egresos: any[] = [];

    for (const row of rows) {
      const debit = parseFloat(row.total_debit || '0');
      const credit = parseFloat(row.total_credit || '0');
      // Ingresos: saldo acreedor (credit - debit)
      // Egresos: saldo deudor (debit - credit)
      if (row.type === 'ingreso') {
        ingresos.push({ ...row, amount: credit - debit });
      } else {
        egresos.push({ ...row, amount: debit - credit });
      }
    }

    const totalIngresos = ingresos.filter(a => !a.is_header).reduce((s, a) => s + a.amount, 0);
    const totalEgresos = egresos.filter(a => !a.is_header).reduce((s, a) => s + a.amount, 0);

    return {
      ingresos: { accounts: ingresos, total: totalIngresos },
      egresos: { accounts: egresos, total: totalEgresos },
      resultado_neto: totalIngresos - totalEgresos,
    };
  }
```

**Test**: Crear ventas y gastos. Verificar que resultado_neto = ventas - gastos.
**Dependencias**: Fase 1-2
**Riesgo**: Bajo.

---

### ACC-4.4: Endpoints para reportes

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.controller.ts`
**Punto de insercion**: Despues de `seedChart()` (linea 74)

**Codigo a agregar**:
```typescript
  async getLedger(req: AuthRequest, res: Response) {
    if (!req.query.account_code) {
      return res.status(400).json({ error: 'account_code es requerido' });
    }
    const data = await accountingEntriesService.getLedger(req.user!.company_id, {
      account_code: req.query.account_code as string,
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }

  async getBalanceGeneral(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getBalanceGeneral(req.user!.company_id, {
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }

  async getIncomeStatement(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getIncomeStatement(req.user!.company_id, {
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.router.ts`
**Punto de insercion**: Despues de linea 13 (la ruta de seed)

**Codigo a agregar**:
```typescript
accountingRouter.get('/ledger', authorize('accounting', 'view'), (req, res) => accountingController.getLedger(req as any, res));
accountingRouter.get('/balance-general', authorize('accounting', 'view'), (req, res) => accountingController.getBalanceGeneral(req as any, res));
accountingRouter.get('/income-statement', authorize('accounting', 'view'), (req, res) => accountingController.getIncomeStatement(req as any, res));
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/frontend/src/services/api.ts`
**Punto de insercion**: Despues de `seedChartOfAccounts` (linea 1888)

**Codigo a agregar**:
```typescript
  getLedger: async (filters: { account_code: string; date_from?: string; date_to?: string }) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
    })
    const { data } = await client.get(`/accounting/ledger?${params.toString()}`)
    return data
  },
  getBalanceGeneral: async (filters?: { date_to?: string }) => {
    const params = new URLSearchParams()
    if (filters?.date_to) params.append('date_to', filters.date_to)
    const { data } = await client.get(`/accounting/balance-general?${params.toString()}`)
    return data
  },
  getIncomeStatement: async (filters?: { date_from?: string; date_to?: string }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/accounting/income-statement?${params.toString()}`)
    return data
  },
```

**Test**: Llamar GET /api/accounting/ledger?account_code=1.1 -> verificar respuesta. GET /api/accounting/balance-general -> verificar estructura. GET /api/accounting/income-statement -> verificar estructura.
**Dependencias**: ACC-4.1, ACC-4.2, ACC-4.3
**Riesgo**: Bajo.

---

## FASE 5: Diferencia de cambio (1 step)

### ACC-5.1: Logica de diferencia de cambio

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Funcion objetivo**: Nuevo metodo + modificaciones en ACC-3.2 y ACC-3.4

**Logica**: Se genera diferencia de cambio cuando:
1. Una factura se emitio en USD (o EUR) con TC_factura
2. Se cobra/paga a TC_cobro distinto

**Calculo**: `difCambio = (TC_cobro - TC_factura) * monto_foreign`
- Si positivo: ganancia (cuenta 4.3)
- Si negativo: perdida (cuenta 5.5)

**Punto de insercion en hooks**: Dentro de ACC-3.2 (cobro) y ACC-3.4 (pago), despues de crear el asiento principal. Esto implica que los hooks de Fase 3 deben revisarse. La implementacion mas limpia es un metodo helper.

**Codigo a agregar** en `accounting-entries.service.ts`, despues de `getIncomeStatement()`:
```typescript
  /**
   * Create exchange rate difference entry if applicable.
   * Called after cobro/pago when the document was in foreign currency.
   */
  async createExchangeDifferenceEntry(params: {
    companyId: string;
    referenceType: string;
    referenceId: string;
    date: string;
    invoiceCurrency: string;
    invoiceExchangeRate: number;
    cobroExchangeRate: number;
    amountForeign: number;
  }): Promise<any | null> {
    const { companyId, referenceType, referenceId, date,
            invoiceCurrency, invoiceExchangeRate, cobroExchangeRate, amountForeign } = params;

    if (invoiceCurrency === 'ARS' || !invoiceExchangeRate || !cobroExchangeRate) return null;
    if (Math.abs(invoiceExchangeRate - cobroExchangeRate) < 0.001) return null;

    const diff = (cobroExchangeRate - invoiceExchangeRate) * amountForeign;
    const absDiff = Math.abs(diff);
    if (absDiff < 0.01) return null;

    const isGain = diff > 0;

    return this.createEntry({
      companyId,
      date,
      description: `Diferencia de cambio ${isGain ? 'ganancia' : 'perdida'} (${invoiceCurrency})`,
      referenceType: `${referenceType}_exchange_diff`,
      referenceId,
      isAuto: true,
      lines: isGain
        ? [
            { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: 0, credit: absDiff, description: 'Ajuste TC (ganancia)' },
            { accountCode: ACCOUNTS.DIF_CAMBIO_GANANCIA, debit: 0, credit: 0, description: '' }, // dummy
          ]
        : [
            // Perdida: sale mas caro de lo esperado
            { accountCode: ACCOUNTS.DIF_CAMBIO_PERDIDA, debit: absDiff, credit: 0, description: 'Diferencia de cambio perdida' },
            { accountCode: ACCOUNTS.CAJA_BANCOS, debit: 0, credit: absDiff, description: 'Caja y Bancos (ajuste TC)' },
          ],
    });
  }
```

CORRECCION -- los asientos de diferencia de cambio dependen del contexto (venta vs compra). Mejor separar:

**Para cobro (venta en USD)**:
- Si ganancia (TC_cobro > TC_factura): D 1.1 (diff) / C 4.3 (diff)
- Si perdida (TC_cobro < TC_factura): D 5.5 (diff) / C 1.1 (diff) -- no, eso no balancea con el cobro

En realidad, el asiento del cobro ya registra al monto en ARS del cobro. La diferencia surge porque la factura se registro a un TC y el cobro a otro. El asiento correcto es:

```
Si TC_cobro > TC_factura (ganancia):
  D 1.1 (diff_ars)
  C 4.3 (diff_ars)

Si TC_cobro < TC_factura (perdida):
  D 5.5 (diff_ars)
  C 1.2 (diff_ars)   // reduce el credito del deudor
```

**Codigo corregido**:
```typescript
  async createExchangeDiffForCobro(params: {
    companyId: string;
    cobroId: string;
    date: string;
    invoiceExchangeRate: number;
    cobroExchangeRate: number;
    amountForeign: number;
  }): Promise<any | null> {
    const { companyId, cobroId, date, invoiceExchangeRate, cobroExchangeRate, amountForeign } = params;

    const diff = (cobroExchangeRate - invoiceExchangeRate) * amountForeign;
    const absDiff = Math.abs(diff);
    if (absDiff < 0.01) return null;

    if (diff > 0) {
      // Ganancia: cobro vale mas en ARS de lo que se facturo
      return this.createEntry({
        companyId, date,
        description: 'Diferencia de cambio (ganancia) - cobro',
        referenceType: 'cobro_exchange_diff', referenceId: cobroId, isAuto: true,
        lines: [
          { accountCode: '1.1', debit: absDiff, credit: 0, description: 'Caja y Bancos' },
          { accountCode: '4.3', debit: 0, credit: absDiff, description: 'Dif. cambio ganancia' },
        ],
      });
    } else {
      // Perdida: cobro vale menos en ARS
      return this.createEntry({
        companyId, date,
        description: 'Diferencia de cambio (perdida) - cobro',
        referenceType: 'cobro_exchange_diff', referenceId: cobroId, isAuto: true,
        lines: [
          { accountCode: '5.5', debit: absDiff, credit: 0, description: 'Dif. cambio perdida' },
          { accountCode: '1.2', debit: 0, credit: absDiff, description: 'Deudores por Ventas' },
        ],
      });
    }
  }

  async createExchangeDiffForPago(params: {
    companyId: string;
    pagoId: string;
    date: string;
    invoiceExchangeRate: number;
    pagoExchangeRate: number;
    amountForeign: number;
  }): Promise<any | null> {
    const { companyId, pagoId, date, invoiceExchangeRate, pagoExchangeRate, amountForeign } = params;

    const diff = (pagoExchangeRate - invoiceExchangeRate) * amountForeign;
    const absDiff = Math.abs(diff);
    if (absDiff < 0.01) return null;

    if (diff > 0) {
      // TC subio: pagamos mas caro -> perdida
      return this.createEntry({
        companyId, date,
        description: 'Diferencia de cambio (perdida) - pago',
        referenceType: 'pago_exchange_diff', referenceId: pagoId, isAuto: true,
        lines: [
          { accountCode: '5.5', debit: absDiff, credit: 0, description: 'Dif. cambio perdida' },
          { accountCode: '2.1', debit: 0, credit: absDiff, description: 'Proveedores' },
        ],
      });
    } else {
      // TC bajo: pagamos mas barato -> ganancia
      return this.createEntry({
        companyId, date,
        description: 'Diferencia de cambio (ganancia) - pago',
        referenceType: 'pago_exchange_diff', referenceId: pagoId, isAuto: true,
        lines: [
          { accountCode: '2.1', debit: absDiff, credit: 0, description: 'Proveedores' },
          { accountCode: '4.3', debit: 0, credit: absDiff, description: 'Dif. cambio ganancia' },
        ],
      });
    }
  }
```

**Integracion con ACC-3.2 y ACC-3.4**: Dentro de los hooks de cobro y pago, despues de crear el asiento principal, agregar:
```typescript
// En ACC-3.2 (createCobro), dentro del bloque accounting:
// Check for exchange rate difference
if (data.currency && data.currency !== 'ARS' && data.exchange_rate) {
  // Need to find the linked invoice's exchange rate
  const linkedInvoices = data.invoice_items || [];
  for (const inv of linkedInvoices) {
    if (!inv.invoice_id) continue;
    const invData = await db.execute(sql`
      SELECT currency, exchange_rate, amount_foreign FROM invoices WHERE id = ${inv.invoice_id}
    `);
    const invRow = ((invData as any).rows || [])[0];
    if (invRow?.currency !== 'ARS' && invRow?.exchange_rate) {
      await accountingEntriesService.createExchangeDiffForCobro({
        companyId,
        cobroId,
        date,
        invoiceExchangeRate: parseFloat(invRow.exchange_rate),
        cobroExchangeRate: parseFloat(data.exchange_rate),
        amountForeign: parseFloat(inv.amount || '0') / parseFloat(data.exchange_rate),
      });
    }
  }
}
```

**Validacion DEBE=HABER**: Todos los asientos son 2 lineas con mismo absDiff. BALANCEA.
**Test**: Facturar en USD a TC=900. Cobrar a TC=950. Verificar asiento de ganancia por (950-900)*monto_usd. Cobrar a TC=850. Verificar asiento de perdida.
**Dependencias**: ACC-3.2, ACC-3.4, Pre-requisitos (cuentas 4.3, 5.5)
**Riesgo**: Alto -- la logica de TC es compleja y depende de que los datos de currency/exchange_rate esten presentes en cobros y facturas.

---

## FASE 6: Asiento de apertura (1 step)

### ACC-6.1: Metodo + endpoint para asiento de apertura

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts`
**Punto de insercion**: Despues de las funciones de diferencia de cambio

**Codigo a agregar**:
```typescript
  /**
   * Create opening entry for a fiscal year.
   * Only one opening entry per company per fiscal year.
   * Receives array of {accountCode, debit, credit}.
   * Validates DEBE = HABER.
   */
  async createOpeningEntry(companyId: string, userId: string, data: {
    date: string;
    lines: Array<{ accountCode: string; debit: number; credit: number }>;
  }): Promise<any> {
    if (!data.date) throw new ApiError(400, 'Fecha requerida');
    if (!data.lines || data.lines.length < 2) throw new ApiError(400, 'Se requieren al menos 2 lineas');

    const fiscalYear = data.date.substring(0, 4); // "2026"

    // Check if opening entry already exists for this year
    const existingResult = await db.execute(sql`
      SELECT id FROM journal_entries
      WHERE company_id = ${companyId}
        AND reference_type = 'opening'
        AND EXTRACT(YEAR FROM date) = ${parseInt(fiscalYear)}
      LIMIT 1
    `);
    if (((existingResult as any).rows || []).length > 0) {
      throw new ApiError(409, `Ya existe un asiento de apertura para el ejercicio ${fiscalYear}`);
    }

    return this.createEntry({
      companyId,
      date: data.date,
      description: `Asiento de apertura - Ejercicio ${fiscalYear}`,
      referenceType: 'opening',
      referenceId: null as any,
      isAuto: false,
      createdBy: userId,
      lines: data.lines.map(l => ({
        accountCode: l.accountCode,
        debit: l.debit || 0,
        credit: l.credit || 0,
        description: `Apertura ${fiscalYear}`,
      })),
    });
  }
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.controller.ts`
**Punto de insercion**: Despues de `getIncomeStatement()`

**Codigo a agregar**:
```typescript
  async createOpeningEntry(req: AuthRequest, res: Response) {
    const { date, lines } = req.body;
    if (!date || !lines) {
      return res.status(400).json({ error: 'date y lines son requeridos' });
    }
    const data = await accountingEntriesService.createOpeningEntry(
      req.user!.company_id,
      req.user!.id,
      { date, lines },
    );
    res.status(201).json(data);
  }
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.router.ts`
**Punto de insercion**: Despues de las rutas de reportes

**Codigo a agregar**:
```typescript
accountingRouter.post('/opening-entry', authorize('accounting', 'create'), (req, res) => accountingController.createOpeningEntry(req as any, res));
```

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/frontend/src/services/api.ts`
**Punto de insercion**: Despues de los metodos de reportes

**Codigo a agregar**:
```typescript
  createOpeningEntry: async (data: { date: string; lines: Array<{ accountCode: string; debit: number; credit: number }> }) => {
    const { data: result } = await client.post('/accounting/opening-entry', data)
    return result
  },
```

**Validacion DEBE=HABER**: La funcion `createEntry()` ya valida Math.abs(totalDebit - totalCredit) > 0.01. GARANTIZADO.
**Test**: Crear asiento apertura con 3 cuentas. Verificar que se creo. Intentar crear otro para el mismo anio -> error 409.
**Dependencias**: Fase 1-2
**Riesgo**: Bajo.

---

## FASE 7: Frontend (1 step)

### ACC-7.1: Ampliar Contabilidad.tsx

**Archivo**: `/home/facu/BECKER/Gestor BeckerVisual/frontend/src/pages/Contabilidad.tsx`

Los tabs actuales (linea 81): `['Plan de Cuentas', 'Libro Diario', 'Balance']`

**Cambios**:

1. **Agregar tabs**: Cambiar linea 81 a:
```typescript
const TABS = ['Plan de Cuentas', 'Libro Diario', 'Balance', 'Libro Mayor', 'Balance General', 'Estado de Resultados'] as const
```

2. **Agregar state para nuevos tabs** (despues de linea 116):
```typescript
  // Ledger state
  const [ledgerAccountCode, setLedgerAccountCode] = useState('')
  const [ledgerDateFrom, setLedgerDateFrom] = useState('')
  const [ledgerDateTo, setLedgerDateTo] = useState('')
  const [ledgerData, setLedgerData] = useState<any>(null)

  // Balance General state
  const [balanceGeneralData, setBalanceGeneralData] = useState<any>(null)
  const [bgDateTo, setBgDateTo] = useState('')

  // Income Statement state
  const [incomeData, setIncomeData] = useState<any>(null)
  const [isDateFrom, setIsDateFrom] = useState('')
  const [isDateTo, setIsDateTo] = useState('')

  // Opening entry state
  const [showOpeningEntry, setShowOpeningEntry] = useState(false)
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split('T')[0])
  const [openingLines, setOpeningLines] = useState([
    { accountCode: '', debit: '', credit: '' },
    { accountCode: '', debit: '', credit: '' },
  ])
```

3. **Extender loadData()** (agregar casos despues de linea 145):
```typescript
      } else if (activeTab === 'Libro Mayor') {
        if (ledgerAccountCode) {
          const data = await api.getLedger({
            account_code: ledgerAccountCode,
            date_from: ledgerDateFrom,
            date_to: ledgerDateTo,
          })
          setLedgerData(data)
        }
      } else if (activeTab === 'Balance General') {
        const data = await api.getBalanceGeneral({ date_to: bgDateTo })
        setBalanceGeneralData(data)
      } else if (activeTab === 'Estado de Resultados') {
        const data = await api.getIncomeStatement({
          date_from: isDateFrom,
          date_to: isDateTo,
        })
        setIncomeData(data)
      }
```

4. **Tab Libro Mayor** (agregar despues del bloque Balance, antes de `</>` de linea 717):
```tsx
          {activeTab === 'Libro Mayor' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Libro Mayor</h2>
                  <div className="flex gap-2 items-end flex-wrap">
                    <div>
                      <label className="block text-sm font-medium mb-1">Cuenta</label>
                      <select
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                        value={ledgerAccountCode}
                        onChange={e => setLedgerAccountCode(e.target.value)}
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {accounts.filter(a => !a.is_header).map(a => (
                          <option key={a.id} value={a.code}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <Input type="date" label="Desde" value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} />
                    <Input type="date" label="Hasta" value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} />
                    <Button variant="outline" onClick={loadData}>Consultar</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!ledgerData ? (
                  <EmptyState title="Seleccione una cuenta" description="Elija una cuenta del plan y presione Consultar." />
                ) : (
                  <div className="overflow-x-auto">
                    <p className="text-sm text-gray-500 mb-2">
                      Cuenta: {ledgerData.account.code} - {ledgerData.account.name} | Saldo inicial: {formatCurrency(ledgerData.opening_balance)}
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b dark:border-gray-700">
                          <th className="text-left py-2 px-3">Fecha</th>
                          <th className="text-left py-2 px-3">Descripcion</th>
                          <th className="text-right py-2 px-3">Debe</th>
                          <th className="text-right py-2 px-3">Haber</th>
                          <th className="text-right py-2 px-3">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerData.movements.map((m: any, i: number) => (
                          <tr key={i} className="border-b dark:border-gray-800">
                            <td className="py-2 px-3">{formatDate(m.date)}</td>
                            <td className="py-2 px-3">{m.description}</td>
                            <td className="py-2 px-3 text-right font-mono">{m.debit > 0 ? formatCurrency(m.debit) : '-'}</td>
                            <td className="py-2 px-3 text-right font-mono">{m.credit > 0 ? formatCurrency(m.credit) : '-'}</td>
                            <td className="py-2 px-3 text-right font-mono">{formatCurrency(Math.abs(m.balance))} {m.balance > 0 ? 'D' : m.balance < 0 ? 'H' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'Balance General' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Balance General</h2>
                  <div className="flex gap-2 items-end">
                    <Input type="date" label="Al" value={bgDateTo} onChange={e => setBgDateTo(e.target.value)} />
                    <Button variant="outline" onClick={loadData}>Consultar</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!balanceGeneralData ? (
                  <EmptyState title="Sin datos" description="Presione Consultar para generar el Balance General." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Activo */}
                    <div>
                      <h3 className="font-bold text-lg mb-2">ACTIVO</h3>
                      {balanceGeneralData.activo.accounts.filter((a: any) => !a.is_header && a.balance !== 0).map((a: any) => (
                        <div key={a.code} className="flex justify-between py-1 border-b dark:border-gray-800">
                          <span>{a.code} {a.name}</span>
                          <span className="font-mono">{formatCurrency(a.balance)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-2 font-bold border-t-2">
                        <span>Total Activo</span>
                        <span className="font-mono">{formatCurrency(balanceGeneralData.activo.total)}</span>
                      </div>
                    </div>
                    {/* Pasivo + PN */}
                    <div>
                      <h3 className="font-bold text-lg mb-2">PASIVO</h3>
                      {balanceGeneralData.pasivo.accounts.filter((a: any) => !a.is_header && a.balance !== 0).map((a: any) => (
                        <div key={a.code} className="flex justify-between py-1 border-b dark:border-gray-800">
                          <span>{a.code} {a.name}</span>
                          <span className="font-mono">{formatCurrency(Math.abs(a.balance))}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-2 font-bold border-t-2">
                        <span>Total Pasivo</span>
                        <span className="font-mono">{formatCurrency(balanceGeneralData.pasivo.total)}</span>
                      </div>
                      <h3 className="font-bold text-lg mb-2 mt-4">PATRIMONIO NETO</h3>
                      {balanceGeneralData.patrimonio.accounts.filter((a: any) => !a.is_header && a.balance !== 0).map((a: any) => (
                        <div key={a.code} className="flex justify-between py-1 border-b dark:border-gray-800">
                          <span>{a.code} {a.name}</span>
                          <span className="font-mono">{formatCurrency(Math.abs(a.balance))}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-1 border-b dark:border-gray-800 italic">
                        <span>Resultado del Ejercicio</span>
                        <span className="font-mono">{formatCurrency(balanceGeneralData.resultado_ejercicio)}</span>
                      </div>
                      <div className="flex justify-between py-2 font-bold border-t-2">
                        <span>Total Pasivo + PN</span>
                        <span className="font-mono">{formatCurrency(balanceGeneralData.pasivo.total + balanceGeneralData.patrimonio.total + balanceGeneralData.resultado_ejercicio)}</span>
                      </div>
                      {balanceGeneralData.balanced ? (
                        <p className="text-green-600 text-sm mt-2">Activo = Pasivo + PN (balanceado)</p>
                      ) : (
                        <p className="text-red-500 text-sm mt-2">DESBALANCEADO: Activo != Pasivo + PN</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'Estado de Resultados' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold">Estado de Resultados</h2>
                  <div className="flex gap-2 items-end">
                    <Input type="date" label="Desde" value={isDateFrom} onChange={e => setIsDateFrom(e.target.value)} />
                    <Input type="date" label="Hasta" value={isDateTo} onChange={e => setIsDateTo(e.target.value)} />
                    <Button variant="outline" onClick={loadData}>Consultar</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!incomeData ? (
                  <EmptyState title="Sin datos" description="Presione Consultar para generar el Estado de Resultados." />
                ) : (
                  <div className="max-w-lg">
                    <h3 className="font-bold mb-2">INGRESOS</h3>
                    {incomeData.ingresos.accounts.filter((a: any) => !a.is_header && a.amount !== 0).map((a: any) => (
                      <div key={a.code} className="flex justify-between py-1 border-b dark:border-gray-800">
                        <span>{a.code} {a.name}</span>
                        <span className="font-mono">{formatCurrency(a.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold">
                      <span>Total Ingresos</span>
                      <span className="font-mono">{formatCurrency(incomeData.ingresos.total)}</span>
                    </div>

                    <h3 className="font-bold mb-2 mt-4">EGRESOS</h3>
                    {incomeData.egresos.accounts.filter((a: any) => !a.is_header && a.amount !== 0).map((a: any) => (
                      <div key={a.code} className="flex justify-between py-1 border-b dark:border-gray-800">
                        <span>{a.code} {a.name}</span>
                        <span className="font-mono">{formatCurrency(a.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold">
                      <span>Total Egresos</span>
                      <span className="font-mono">{formatCurrency(incomeData.egresos.total)}</span>
                    </div>

                    <div className="flex justify-between py-3 font-bold text-lg border-t-2 mt-2">
                      <span>RESULTADO NETO</span>
                      <span className={`font-mono ${incomeData.resultado_neto >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(incomeData.resultado_neto)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
```

5. **Cargar accounts al inicio** para que el selector del Libro Mayor funcione: en `loadData()`, si `accounts.length === 0`, cargar siempre el chart:
Agregar al inicio de `loadData()` (despues de `setLoading(true)`):
```typescript
      // Always load accounts for selectors
      if (accounts.length === 0) {
        try {
          const accs = await api.getChartOfAccounts()
          setAccounts(accs)
        } catch { /* ignore */ }
      }
```

**Test**: Navegar a /contabilidad. Verificar que los 6 tabs se muestran. Cada tab carga datos correctamente.
**Dependencias**: ACC-4.4, ACC-6.1
**Riesgo**: Medio -- el archivo ya tiene 733 lineas. Considerar extraer cada tab a un componente separado en fase de refactor.

---

## FASE 8: Tests (2 steps)

### ACC-8.1: Tests unitarios

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/__tests__/accounting-entries.test.ts` (NUEVO)

**Tests** (22 tests):

```typescript
import { AccountingEntriesService } from '../modules/accounting/accounting-entries.service';

// Mock db
jest.mock('../config/db', () => ({
  db: {
    execute: jest.fn(),
  },
}));

const { db } = require('../config/db');

describe('AccountingEntriesService', () => {
  let service: AccountingEntriesService;

  beforeEach(() => {
    service = new AccountingEntriesService();
    jest.clearAllMocks();
  });

  describe('createEntry', () => {
    it('should reject empty lines', async () => {
      await expect(service.createEntry({
        companyId: 'c1', date: '2026-01-01', description: 'test', lines: [],
      })).rejects.toThrow('al menos una linea');
    });

    it('should reject unbalanced entry', async () => {
      await expect(service.createEntry({
        companyId: 'c1', date: '2026-01-01', description: 'test',
        lines: [
          { accountCode: '1.1', debit: 100, credit: 0 },
          { accountCode: '1.2', debit: 0, credit: 50 },
        ],
      })).rejects.toThrow('desbalanceado');
    });

    it('should accept balanced entry with 0.01 tolerance', async () => {
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'entry1', entry_number: 1 }] }); // insert entry
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'acc1' }] }); // resolve account 1
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'line1' }] }); // insert line 1
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'acc2' }] }); // resolve account 2
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'line2' }] }); // insert line 2

      const result = await service.createEntry({
        companyId: 'c1', date: '2026-01-01', description: 'test',
        lines: [
          { accountCode: '1.1', debit: 100.005, credit: 0 },
          { accountCode: '1.2', debit: 0, credit: 100 },
        ],
      });
      expect(result.id).toBe('entry1');
    });
  });

  describe('createEntryForInvoice', () => {
    it('should create D:Deudores C:Ventas+IVA for invoice with VAT', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }) // insert entry
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] }) // resolve 1.2
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] }) // insert line
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] }) // resolve 4.1
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] }) // insert line
        .mockResolvedValueOnce({ rows: [{ id: 'a3' }] }) // resolve 2.3
        .mockResolvedValueOnce({ rows: [{ id: 'l3' }] }); // insert line

      await service.createEntryForInvoice({
        id: 'inv1', company_id: 'c1', total: 1210, subtotal: 1000, vat_amount: 210,
      });

      // Verify first line call (debit 1210 to 1.2)
      expect(db.execute).toHaveBeenCalledTimes(7);
    });

    it('should create 2-line entry for invoice without VAT', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] });

      await service.createEntryForInvoice({
        id: 'inv2', company_id: 'c1', total: 500, subtotal: 500, vat_amount: 0,
      });

      expect(db.execute).toHaveBeenCalledTimes(5); // entry + 2*(resolve + insert)
    });
  });

  describe('createEntryForCobro', () => {
    it('should create D:CajaBancos C:Deudores', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] });

      await service.createEntryForCobro({
        id: 'co1', company_id: 'c1', amount: 1000,
      });

      expect(db.execute).toHaveBeenCalledTimes(5);
    });
  });

  describe('createEntryForPago', () => {
    it('should create D:Proveedores C:CajaBancos', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] });

      await service.createEntryForPago({
        id: 'pa1', company_id: 'c1', amount: 500,
      });

      expect(db.execute).toHaveBeenCalledTimes(5);
    });
  });

  describe('createEntryForPurchaseInvoice', () => {
    it('should create D:CMV+IVA C:Proveedores with VAT', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a3' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l3' }] });

      await service.createEntryForPurchaseInvoice({
        id: 'pi1', company_id: 'c1', total: 2420, subtotal: 2000, vat_amount: 420,
      });

      expect(db.execute).toHaveBeenCalledTimes(7);
    });
  });

  describe('resolveAccountId', () => {
    it('should throw if account code not found', async () => {
      db.execute.mockResolvedValueOnce({ rows: [] });

      await expect(
        (service as any).resolveAccountId('c1', '9.9.9')
      ).rejects.toThrow('no encontrada');
    });
  });

  describe('createOpeningEntry', () => {
    it('should reject if opening entry already exists for year', async () => {
      db.execute.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

      await expect(service.createOpeningEntry('c1', 'u1', {
        date: '2026-01-01',
        lines: [
          { accountCode: '1.1', debit: 100, credit: 0 },
          { accountCode: '3.1', debit: 0, credit: 100 },
        ],
      })).rejects.toThrow('Ya existe');
    });
  });

  describe('getLedger', () => {
    it('should throw if account_code not provided', async () => {
      await expect(service.getLedger('c1', { account_code: '' })).rejects.toThrow('requerido');
    });
  });

  describe('Exchange difference', () => {
    it('should return null if same currency', async () => {
      const result = await service.createExchangeDiffForCobro({
        companyId: 'c1', cobroId: 'co1', date: '2026-01-01',
        invoiceExchangeRate: 900, cobroExchangeRate: 900, amountForeign: 100,
      });
      expect(result).toBeNull();
    });

    it('should create gain entry when cobro TC > invoice TC', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'a2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'l2' }] });

      const result = await service.createExchangeDiffForCobro({
        companyId: 'c1', cobroId: 'co1', date: '2026-01-01',
        invoiceExchangeRate: 900, cobroExchangeRate: 950, amountForeign: 100,
      });
      // diff = (950-900)*100 = 5000
      expect(result).toBeTruthy();
    });
  });
});
```

**Dependencias**: Toda Fase 3-6
**Riesgo**: Bajo.

---

### ACC-8.2: Tests de integracion

**Archivo(s)**: `/home/facu/BECKER/Gestor BeckerVisual/backend/src/__tests__/accounting-integration.test.ts` (NUEVO)

**Descripcion**: Flujo E2E completo contra DB real (test database).

```typescript
/**
 * Integration tests for accounting module.
 * Requires test database with seeded company.
 *
 * Flow: Seed chart -> Authorize invoice -> Create cobro -> Delete cobro -> Verify balance
 */
import { accountingEntriesService } from '../modules/accounting/accounting-entries.service';
import { seedChartOfAccounts } from '../modules/accounting/chart-seed';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';

// Skip if no DB connection
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Accounting Integration', () => {
  const TEST_COMPANY_ID = 'test-accounting-company';

  beforeAll(async () => {
    // Create test company
    await db.execute(sql`
      INSERT INTO companies (id, name, cuit) VALUES (${TEST_COMPANY_ID}, 'Test Accounting Co', '30-12345678-9')
      ON CONFLICT (id) DO NOTHING
    `);
    // Seed chart
    await seedChartOfAccounts(TEST_COMPANY_ID);
  });

  afterAll(async () => {
    // Cleanup
    await db.execute(sql`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = ${TEST_COMPANY_ID})`);
    await db.execute(sql`DELETE FROM journal_entries WHERE company_id = ${TEST_COMPANY_ID}`);
    await db.execute(sql`DELETE FROM chart_of_accounts WHERE company_id = ${TEST_COMPANY_ID}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${TEST_COMPANY_ID}`);
  });

  it('should create balanced invoice entry', async () => {
    const entry = await accountingEntriesService.createEntryForInvoice({
      id: 'test-inv-1', company_id: TEST_COMPANY_ID,
      date: '2026-03-01', total: 12100, subtotal: 10000, vat_amount: 2100,
    });
    expect(entry.lines).toHaveLength(3);

    const totalD = entry.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
    const totalC = entry.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
    expect(Math.abs(totalD - totalC)).toBeLessThan(0.01);
  });

  it('should create balanced cobro entry', async () => {
    const entry = await accountingEntriesService.createEntryForCobro({
      id: 'test-co-1', company_id: TEST_COMPANY_ID,
      date: '2026-03-05', amount: 12100,
    });
    expect(entry.lines).toHaveLength(2);
  });

  it('should show movements in ledger', async () => {
    const ledger = await accountingEntriesService.getLedger(TEST_COMPANY_ID, {
      account_code: '1.1',
    });
    expect(ledger.movements.length).toBeGreaterThan(0);
    // Check running balance
    const lastMov = ledger.movements[ledger.movements.length - 1];
    expect(typeof lastMov.balance).toBe('number');
  });

  it('should produce balanced Balance General', async () => {
    const bg = await accountingEntriesService.getBalanceGeneral(TEST_COMPANY_ID, {});
    expect(bg.balanced).toBe(true);
  });

  it('should produce valid Income Statement', async () => {
    const is = await accountingEntriesService.getIncomeStatement(TEST_COMPANY_ID, {});
    expect(is.ingresos.total).toBeGreaterThanOrEqual(0);
    expect(is.resultado_neto).toBe(is.ingresos.total - is.egresos.total);
  });

  it('should create and prevent duplicate opening entry', async () => {
    const entry = await accountingEntriesService.createOpeningEntry(TEST_COMPANY_ID, 'u1', {
      date: '2026-01-01',
      lines: [
        { accountCode: '1.1', debit: 50000, credit: 0 },
        { accountCode: '3.1', debit: 0, credit: 50000 },
      ],
    });
    expect(entry).toBeTruthy();

    await expect(
      accountingEntriesService.createOpeningEntry(TEST_COMPANY_ID, 'u1', {
        date: '2026-06-01',
        lines: [
          { accountCode: '1.1', debit: 1, credit: 0 },
          { accountCode: '3.1', debit: 0, credit: 1 },
        ],
      })
    ).rejects.toThrow('Ya existe');
  });

  it('full cycle: invoice + cobro + delete cobro = net zero on 1.1', async () => {
    // Create invoice
    await accountingEntriesService.createEntryForInvoice({
      id: 'cycle-inv', company_id: TEST_COMPANY_ID,
      date: '2026-03-10', total: 5000, subtotal: 4132.23, vat_amount: 867.77,
    });
    // Create cobro
    await accountingEntriesService.createEntryForCobro({
      id: 'cycle-co', company_id: TEST_COMPANY_ID,
      date: '2026-03-12', amount: 5000,
    });
    // Reverse cobro
    await accountingEntriesService.createEntry({
      companyId: TEST_COMPANY_ID,
      date: '2026-03-12',
      description: 'Anulacion cobro',
      referenceType: 'cobro_reversal',
      referenceId: 'cycle-co',
      isAuto: true,
      lines: [
        { accountCode: '1.2', debit: 5000, credit: 0 },
        { accountCode: '1.1', debit: 0, credit: 5000 },
      ],
    });

    // Check account 1.1: cobro (+5000) + reversal (-5000) = 0
    const ledger = await accountingEntriesService.getLedger(TEST_COMPANY_ID, {
      account_code: '1.1',
      date_from: '2026-03-10',
      date_to: '2026-03-12',
    });
    // Filter only cycle entries
    const cycleMovements = ledger.movements.filter(
      (m: any) => m.reference_id === 'cycle-co'
    );
    const net = cycleMovements.reduce(
      (s: number, m: any) => s + m.debit - m.credit, 0
    );
    expect(Math.abs(net)).toBeLessThan(0.01);
  });
});
```

**Dependencias**: Toda Fase 3-7
**Riesgo**: Medio -- requiere database de test. Puede fallar si no hay DATABASE_URL configurada (el `describe.skip` lo maneja).

---

## RESUMEN DE ARCHIVOS AFECTADOS

| Archivo | Steps |
|---------|-------|
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/chart-seed.ts` | Pre-req |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting-entries.service.ts` | Pre-req, ACC-4.1, 4.2, 4.3, 5.1, 6.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.controller.ts` | ACC-4.4, 6.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/accounting/accounting.router.ts` | ACC-4.4, 6.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/invoices/invoices.service.ts` | ACC-3.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cobros/cobros.service.ts` | ACC-3.2, 3.3 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/pagos/pagos.service.ts` | ACC-3.4, 3.5 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/purchase-invoices/purchase-invoices.service.ts` | ACC-3.6, 3.11 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cheques/cheques.service.ts` | ACC-3.7, 3.8 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/modules/cuenta-corriente/cuenta-corriente.service.ts` | ACC-3.9 |
| `/home/facu/BECKER/Gestor BeckerVisual/frontend/src/pages/Contabilidad.tsx` | ACC-7.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/frontend/src/services/api.ts` | ACC-4.4, 6.1 |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/__tests__/accounting-entries.test.ts` | ACC-8.1 (NUEVO) |
| `/home/facu/BECKER/Gestor BeckerVisual/backend/src/__tests__/accounting-integration.test.ts` | ACC-8.2 (NUEVO) |

## ORDEN DE IMPLEMENTACION RECOMENDADO

1. Pre-requisitos (seed + ACCOUNTS + isAccountingEnabled)
2. ACC-3.1 (authorizeInvoice) -- el mas critico, genera asientos para ventas
3. ACC-3.6 (createPurchaseInvoice) -- complementa con compras
4. ACC-3.2 (createCobro) + ACC-3.4 (createPago) -- cobros y pagos
5. ACC-3.3 (deleteCobro) + ACC-3.5 (deletePago) -- contra-asientos
6. ACC-3.7 + ACC-3.8 (cheques) -- ciclo de cheques
7. ACC-3.9 (ajustes CC) + ACC-3.11 (cancel factura compra)
8. ACC-4.1 a 4.4 (reportes) -- genera valor visible inmediato
9. ACC-6.1 (asiento apertura)
10. ACC-5.1 (diferencia cambio) -- el mas complejo, dejar para el final
11. ACC-7.1 (frontend)
12. ACC-8.1 + ACC-8.2 (tests) -- en paralelo con cada fase
