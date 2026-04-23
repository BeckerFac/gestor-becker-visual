import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class CuentaCorrienteService {
  /**
   * Get CC summary per enterprise, optionally filtered by business_unit_id.
   *
   * NEW calculation using cobro_invoice_applications and pago_invoice_applications:
   * - total_ventas = SUM(invoices.total_amount) where status != cancelled
   * - total_cobros_aplicados = SUM(cobro_invoice_applications.amount_applied) via invoices
   * - adelantos_cobros = SUM(cobros.amount) where pending_status = 'pending_invoice'
   * - total_compras = SUM(purchase_invoices.total_amount) where status != cancelled
   * - total_pagos_aplicados = SUM(pago_invoice_applications.amount_applied) via purchase_invoices
   * - adelantos_pagos = SUM(pagos.amount) where pending_status = 'pending_invoice'
   * - ajustes debit/credit from account_adjustments
   */
  async getResumen(
    companyId: string,
    businessUnitIdOrOpts?: string | { businessUnitId?: string; userCanAccessLuna?: boolean },
    userCanAccessLunaArg?: boolean
  ) {
    // Support both legacy positional signature (companyId, buId) and the new
    // CAT-6 opts object. Defaults: no BU filter, Luna hidden.
    const businessUnitId = typeof businessUnitIdOrOpts === 'string'
      ? businessUnitIdOrOpts
      : businessUnitIdOrOpts?.businessUnitId;
    const userCanAccessLuna = typeof businessUnitIdOrOpts === 'object' && businessUnitIdOrOpts !== null
      ? Boolean(businessUnitIdOrOpts.userCanAccessLuna)
      : Boolean(userCanAccessLunaArg);
    try {
      // PR7-T21: each subquery uses a different table alias, so we need
      // per-alias BU filters to avoid "column reference is ambiguous" error.
      // The axios interceptor in the frontend auto-injects business_unit_id on ALL GETs.
      // Nor-fix (item 1): BU filter includes orphan rows (business_unit_id IS NULL)
      // so Dashboard/CC remain consistent with listings after the NULL-visibility fix.
      const buFilterI = businessUnitId ? sql` AND (i.business_unit_id = ${businessUnitId} OR i.business_unit_id IS NULL)` : sql``;
      const buFilterCo = businessUnitId ? sql` AND (co.business_unit_id = ${businessUnitId} OR co.business_unit_id IS NULL)` : sql``;
      const buFilterCs = businessUnitId ? sql` AND (cs.business_unit_id = ${businessUnitId} OR cs.business_unit_id IS NULL)` : sql``;
      const buFilterPi = businessUnitId ? sql` AND (pi.business_unit_id = ${businessUnitId} OR pi.business_unit_id IS NULL)` : sql``;
      const buFilterPa = businessUnitId ? sql` AND (pa.business_unit_id = ${businessUnitId} OR pa.business_unit_id IS NULL)` : sql``;

      // PR7-T16: defensive try/catch para migrations no aplicadas.
      // Verificar que las columnas/tablas criticas existan, sino loguear warning
      // y que cada subquery falle soft con 0 (en vez de crashear todo el resumen).
      // Primero: detectar si cobros.status existe. Si no, no filtrar anulados.
      let cobrosStatusExists = true;
      try {
        await db.execute(sql`SELECT status FROM cobros LIMIT 1`);
      } catch {
        cobrosStatusExists = false;
        console.warn('[cuenta-corriente] cobros.status column missing — anulado filter disabled');
      }
      const cobrosAnuladoFilter = cobrosStatusExists
        ? sql` AND (cs.status IS NULL OR cs.status != 'anulado')`
        : sql``;
      const cobrosAnuladoFilterCo = cobrosStatusExists
        ? sql` AND (co.status IS NULL OR co.status != 'anulado')`
        : sql``;

      // PR7-T16 mirror: detectar pagos.status — mismo patron defensivo que cobros.
      let pagosStatusExists = true;
      try {
        await db.execute(sql`SELECT status FROM pagos LIMIT 1`);
      } catch {
        pagosStatusExists = false;
        console.warn('[cuenta-corriente] pagos.status column missing — anulado filter disabled');
      }
      const pagosAnuladoFilterPa = pagosStatusExists
        ? sql` AND (pa.status IS NULL OR pa.status != 'anulado')`
        : sql``;

      // H2: BU filter on account_adjustments requires the column to exist. If it
      // doesn't, we skip the filter entirely (and resumen may show adjustments
      // from all BUs — documented gap, pending schema migration).
      let ajustesBusinessUnitExists = true;
      try {
        await db.execute(sql`SELECT business_unit_id FROM account_adjustments LIMIT 1`);
      } catch {
        ajustesBusinessUnitExists = false;
        if (businessUnitId) {
          console.warn('[cuenta-corriente] account_adjustments.business_unit_id missing — BU filter skipped for adjustments');
        }
      }
      const ajustesBuFilter = businessUnitId && ajustesBusinessUnitExists
        ? sql` AND (aa.business_unit_id = ${businessUnitId} OR aa.business_unit_id IS NULL)`
        : sql``;

      // C2: multi-currency detection. If purchase_invoices.currency exists and
      // there's a mix of currencies for any enterprise, we warn — the current
      // resumen sums numeric amounts across currencies, which is semantically wrong.
      // TODO: break resumen into per-currency buckets. For now we flag and keep
      // ARS-equivalent sums (the existing behavior) so this PR is non-breaking.
      try {
        const mix = await db.execute(sql`
          SELECT enterprise_id, COUNT(DISTINCT currency) AS n
          FROM purchase_invoices
          WHERE company_id = ${companyId}
          GROUP BY enterprise_id
          HAVING COUNT(DISTINCT currency) > 1
          LIMIT 1
        `);
        const mixRows = (mix as any).rows || [];
        if (mixRows.length > 0) {
          console.warn('[cuenta-corriente] WARNING multi-currency supplier detected — resumen mixes currencies. TODO: split by currency.');
        }
      } catch {
        // purchase_invoices.currency column missing — single currency, ignore.
      }

      const result = await db.execute(sql`
        SELECT
          e.id, e.name, e.cuit, e.status,

          -- CAT-6: Sol/Luna split via SUM(CASE WHEN fiscal_type=...) aggregates.
          -- Single query per row, one pass on each source table.
          -- NCs excluded from calculations. This is the PR7-T13 semantic: NCs never
          -- add to revenue nor reduce cobros applied. NCs-as-credit is a separate feature (TODO).
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='fiscal' THEN CAST(i.total_amount AS decimal) ELSE 0 END)
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ventas_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='no_fiscal' THEN CAST(i.total_amount AS decimal) ELSE 0 END)
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ventas_luna,
          -- Legacy total_ventas retained for back-compat (tests use this label).
          COALESCE((
            SELECT SUM(CAST(i.total_amount AS decimal))
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ventas,

          -- Cobros aplicados (via tabla intermedia)
          -- PR7-T5/T16: excluir cobros anulados si la columna status existe.
          -- NCs excluded: si la application apunta a una NC, NO se cuenta como cobro aplicado.
          -- CAT-6: Sol/Luna split by invoice.fiscal_type (applications inherit from their invoice).
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='fiscal' THEN CAST(cia.amount_applied AS decimal) ELSE 0 END)
            FROM cobro_invoice_applications cia
            JOIN invoices i ON cia.invoice_id = i.id
            JOIN cobros cs ON cia.cobro_id = cs.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${cobrosAnuladoFilter}
              ${buFilterI}
          ), 0) as total_cobros_aplicados_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='no_fiscal' THEN CAST(cia.amount_applied AS decimal) ELSE 0 END)
            FROM cobro_invoice_applications cia
            JOIN invoices i ON cia.invoice_id = i.id
            JOIN cobros cs ON cia.cobro_id = cs.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${cobrosAnuladoFilter}
              ${buFilterI}
          ), 0) as total_cobros_aplicados_luna,
          COALESCE((
            SELECT SUM(CAST(cia.amount_applied AS decimal))
            FROM cobro_invoice_applications cia
            JOIN invoices i ON cia.invoice_id = i.id
            JOIN cobros cs ON cia.cobro_id = cs.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.invoice_type::text NOT LIKE 'NC%'
              ${cobrosAnuladoFilter}
              ${buFilterI}
          ), 0) as total_cobros_aplicados,

          -- Adelantos cobros (monto NO asignado de cobros pending)
          COALESCE((
            SELECT SUM(
              CAST(COALESCE(co.total_amount, co.amount) AS decimal) - COALESCE((
                SELECT SUM(CAST(cia_inner.amount_applied AS decimal))
                FROM cobro_invoice_applications cia_inner
                WHERE cia_inner.cobro_id = co.id
              ), 0)
            )
            FROM cobros co
            WHERE co.company_id = ${companyId}
              AND co.enterprise_id = e.id
              AND co.pending_status = 'pending_invoice'
              ${cobrosAnuladoFilterCo}
              ${buFilterCo}
          ), 0) as total_adelantos_cobros,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(co.fiscal_type,'fiscal')='fiscal' THEN
              CAST(COALESCE(co.total_amount, co.amount) AS decimal) - COALESCE((
                SELECT SUM(CAST(cia_inner.amount_applied AS decimal))
                FROM cobro_invoice_applications cia_inner
                WHERE cia_inner.cobro_id = co.id
              ), 0) ELSE 0 END)
            FROM cobros co
            WHERE co.company_id = ${companyId}
              AND co.enterprise_id = e.id
              AND co.pending_status = 'pending_invoice'
              ${cobrosAnuladoFilterCo}
              ${buFilterCo}
          ), 0) as total_adelantos_cobros_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(co.fiscal_type,'fiscal')='no_fiscal' THEN
              CAST(COALESCE(co.total_amount, co.amount) AS decimal) - COALESCE((
                SELECT SUM(CAST(cia_inner.amount_applied AS decimal))
                FROM cobro_invoice_applications cia_inner
                WHERE cia_inner.cobro_id = co.id
              ), 0) ELSE 0 END)
            FROM cobros co
            WHERE co.company_id = ${companyId}
              AND co.enterprise_id = e.id
              AND co.pending_status = 'pending_invoice'
              ${cobrosAnuladoFilterCo}
              ${buFilterCo}
          ), 0) as total_adelantos_cobros_luna,

          -- Compras: purchase_invoices no canceladas
          -- NCs excluded per PR7-T13 semantic: NCs neither inflate nor subtract from compras.
          -- NCs-as-credit (true reduction of supplier debt) is a separate feature TODO.
          COALESCE((
            SELECT SUM(CAST(pi.total_amount AS decimal))
            FROM purchase_invoices pi
            WHERE pi.company_id = ${companyId}
              AND pi.enterprise_id = e.id
              AND pi.status NOT IN ('cancelled', 'cancelado')
              AND pi.invoice_type::text NOT LIKE 'NC%'
              ${buFilterPi}
          ), 0) as total_compras,

          -- Pagos aplicados (via tabla intermedia)
          -- Excluir pagos anulados (defensive, mismo patron que cobros).
          -- NCs excluded per PR7-T13: si la application apunta a una NC_compra, NO cuenta como pago aplicado.
          COALESCE((
            SELECT SUM(CAST(pia.amount_applied AS decimal))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            JOIN pagos pa ON pia.pago_id = pa.id
            WHERE pi.company_id = ${companyId}
              AND pi.enterprise_id = e.id
              AND pi.status NOT IN ('cancelled', 'cancelado')
              AND pi.invoice_type::text NOT LIKE 'NC%'
              ${pagosAnuladoFilterPa}
              ${buFilterPi}
          ), 0) as total_pagos_aplicados,

          -- Adelantos pagos (monto NO asignado de pagos pending)
          COALESCE((
            SELECT SUM(
              CAST(COALESCE(pa.total_amount, pa.amount) AS decimal) - COALESCE((
                SELECT SUM(CAST(pia_inner.amount_applied AS decimal))
                FROM pago_invoice_applications pia_inner
                WHERE pia_inner.pago_id = pa.id
              ), 0)
            )
            FROM pagos pa
            WHERE pa.company_id = ${companyId}
              AND pa.enterprise_id = e.id
              AND pa.pending_status = 'pending_invoice'
              ${pagosAnuladoFilterPa}
              ${buFilterPa}
          ), 0) as total_adelantos_pagos,

          -- Ajustes debit
          -- H2: BU filter aplicado si account_adjustments tiene la columna (defensive).
          -- CAT-6: split por fiscal_type. Total preserved for legacy.
          COALESCE((
            SELECT SUM(CAST(aa.amount AS decimal))
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'debit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_debit,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(aa.fiscal_type,'fiscal')='fiscal' THEN CAST(aa.amount AS decimal) ELSE 0 END)
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'debit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_debit_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(aa.fiscal_type,'fiscal')='no_fiscal' THEN CAST(aa.amount AS decimal) ELSE 0 END)
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'debit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_debit_luna,

          -- Ajustes credit
          COALESCE((
            SELECT SUM(ABS(CAST(aa.amount AS decimal)))
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'credit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_credit,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(aa.fiscal_type,'fiscal')='fiscal' THEN ABS(CAST(aa.amount AS decimal)) ELSE 0 END)
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'credit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_credit_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(aa.fiscal_type,'fiscal')='no_fiscal' THEN ABS(CAST(aa.amount AS decimal)) ELSE 0 END)
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'credit'
              ${ajustesBuFilter}
          ), 0) as total_ajustes_credit_luna,

          -- Retenciones sufridas (el cliente nos retuvo — reduce lo que nos debe)
          -- H5: excluir retenciones atadas a cobros anulados. H2: heredar BU del cobro linkeado.
          -- CAT-6: Luna has NO retenciones (enforced by CAT-5), so luna subquery always 0.
          COALESCE((
            SELECT SUM(CAST(r.amount AS decimal))
            FROM retenciones r
            LEFT JOIN cobros rc ON rc.id = r.cobro_id
            WHERE r.company_id = ${companyId}
              AND r.enterprise_id = e.id
              AND r.direction = 'sufrida'
              AND (r.cobro_id IS NULL OR rc.id IS NULL OR ${cobrosStatusExists ? sql`(rc.status IS NULL OR rc.status != 'anulado')` : sql`TRUE`})
              AND (r.cobro_id IS NULL OR COALESCE(rc.fiscal_type,'fiscal')='fiscal')
              ${businessUnitId
                ? sql` AND (r.cobro_id IS NULL OR rc.business_unit_id = ${businessUnitId} OR rc.business_unit_id IS NULL)`
                : sql``}
          ), 0) as total_retenciones_sufridas_sol,
          -- Retenciones sufridas total (legacy field), Luna should remain 0 by design.
          COALESCE((
            SELECT SUM(CAST(r.amount AS decimal))
            FROM retenciones r
            LEFT JOIN cobros rc ON rc.id = r.cobro_id
            WHERE r.company_id = ${companyId}
              AND r.enterprise_id = e.id
              AND r.direction = 'sufrida'
              AND (r.cobro_id IS NULL OR rc.id IS NULL OR ${cobrosStatusExists ? sql`(rc.status IS NULL OR rc.status != 'anulado')` : sql`TRUE`})
              ${businessUnitId
                ? sql` AND (r.cobro_id IS NULL OR rc.business_unit_id = ${businessUnitId} OR rc.business_unit_id IS NULL)`
                : sql``}
          ), 0) as total_retenciones_sufridas,

          -- Retenciones practicadas (nosotros retuvimos al proveedor — reduce lo que le debemos)
          -- H5: excluir retenciones atadas a pagos anulados. H2: heredar BU del pago linkeado.
          COALESCE((
            SELECT SUM(CAST(r.amount AS decimal))
            FROM retenciones r
            LEFT JOIN pagos rp ON rp.id = r.pago_id
            WHERE r.company_id = ${companyId}
              AND r.enterprise_id = e.id
              AND r.direction = 'practicada'
              AND (r.pago_id IS NULL OR rp.id IS NULL OR ${pagosStatusExists ? sql`(rp.status IS NULL OR rp.status != 'anulado')` : sql`TRUE`})
              ${businessUnitId
                ? sql` AND (r.pago_id IS NULL OR rp.business_unit_id = ${businessUnitId} OR rp.business_unit_id IS NULL)`
                : sql``}
          ), 0) as total_retenciones_practicadas,

          -- NCs (Notas de Credito) de venta — anulan/reducen lo que el cliente debe.
          -- Se incluyen SOLO NCs emitidas (status NOT IN ('cancelled','draft')), con la misma
          -- semantica que las facturas: un NC draft no reduce saldo, un NC cancelled tampoco.
          -- Sign convention: total_ncs suma positiva, luego se RESTA del saldo del cliente.
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='fiscal' THEN CAST(i.total_amount AS decimal) ELSE 0 END)
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ncs_sol,
          COALESCE((
            SELECT SUM(CASE WHEN COALESCE(i.fiscal_type,'fiscal')='no_fiscal' THEN CAST(i.total_amount AS decimal) ELSE 0 END)
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ncs_luna,
          COALESCE((
            SELECT SUM(CAST(i.total_amount AS decimal))
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status NOT IN ('cancelled', 'draft')
              AND i.invoice_type::text LIKE 'NC%'
              ${buFilterI}
          ), 0) as total_ncs

        FROM enterprises e
        WHERE e.company_id = ${companyId}
        ORDER BY e.name ASC
      `);
      const rows = (result as any).rows || result || [];

      return rows.map((r: any) => {
        // CAT-6: compute per-circuit balances.
        // Formula per circuit: ventas + ajustesDebit - cobrosAplicados - retencionesSufridas - ajustesCredit
        // (note: excludes the "compra side" — CC cliente vs CC proveedor is still mixed
        //  in the legacy saldo field, but Sol/Luna split only scopes the VENTAS/cobros flow
        //  because Luna never has purchase invoices or pagos.)
        const ventasSol = parseFloat(r.total_ventas_sol || '0');
        const ventasLuna = parseFloat(r.total_ventas_luna || '0');
        const cobrosAplSol = parseFloat(r.total_cobros_aplicados_sol || '0');
        const cobrosAplLuna = parseFloat(r.total_cobros_aplicados_luna || '0');
        const adelCobrosSol = parseFloat(r.total_adelantos_cobros_sol || '0');
        const adelCobrosLuna = parseFloat(r.total_adelantos_cobros_luna || '0');
        const ajDebitSol = parseFloat(r.total_ajustes_debit_sol || '0');
        const ajDebitLuna = parseFloat(r.total_ajustes_debit_luna || '0');
        const ajCreditSol = parseFloat(r.total_ajustes_credit_sol || '0');
        const ajCreditLuna = parseFloat(r.total_ajustes_credit_luna || '0');
        const retSufridasSol = parseFloat(r.total_retenciones_sufridas_sol || '0');
        // NCs reduce client balance: anular/acreditar lo facturado. Same convention as retenciones sufridas.
        const ncsSol = parseFloat(r.total_ncs_sol || '0');
        const ncsLuna = parseFloat(r.total_ncs_luna || '0');
        // Luna has no retenciones by design (enforced by CAT-5).
        const totalCobrosSol = cobrosAplSol + adelCobrosSol;
        const totalCobrosLuna = cobrosAplLuna + adelCobrosLuna;
        const saldoSol = ventasSol + ajDebitSol - totalCobrosSol - retSufridasSol - ajCreditSol - ncsSol;
        const saldoLuna = ventasLuna + ajDebitLuna - totalCobrosLuna - ajCreditLuna - ncsLuna;

        const ventas = parseFloat(r.total_ventas || '0');
        const cobrosAplicados = parseFloat(r.total_cobros_aplicados || '0');
        const adelantosCobros = parseFloat(r.total_adelantos_cobros || '0');
        const compras = parseFloat(r.total_compras || '0');
        const pagosAplicados = parseFloat(r.total_pagos_aplicados || '0');
        const adelantosPagos = parseFloat(r.total_adelantos_pagos || '0');
        const ajustesDebit = parseFloat(r.total_ajustes_debit || '0');
        const ajustesCredit = parseFloat(r.total_ajustes_credit || '0');
        const retencionesSufridas = parseFloat(r.total_retenciones_sufridas || '0');
        const retencionesPracticadas = parseFloat(r.total_retenciones_practicadas || '0');
        const totalNcs = parseFloat(r.total_ncs || '0');

        // LOGIC: Balance reflects CASH REALITY (all money in/out)
        // "Sin asociar" is informational only — the money already moved
        // Retenciones: sufridas reduce deuda cliente, practicadas reduce deuda proveedor
        // They are NOT included in cobro_invoice_applications (those only track net amount)
        //
        const totalCobros = cobrosAplicados + adelantosCobros;
        const totalPagos = pagosAplicados + adelantosPagos;

        // Facturas pendientes (paper debt — applied cobros + retenciones + NCs reduce this)
        const pendienteCobro = Math.max(ventas + ajustesDebit - cobrosAplicados - retencionesSufridas - ajustesCredit - totalNcs, 0);
        const pendientePago = Math.max(compras - pagosAplicados - retencionesPracticadas, 0);

        // Cobros/pagos sin factura asociada (info: "ir a vincular en Cobros/Pagos")
        const cobrosNoAsociados = adelantosCobros;
        const pagosNoAsociados = adelantosPagos;

        // Balance REAL = todo el dinero que entró - todo el dinero que salió
        // Incluye cobros y pagos sin asociar porque la plata ya se movió
        // Retenciones: sufridas son como cobros adicionales, practicadas como pagos adicionales
        // NCs: reducen la deuda del cliente (son como cobros "documentales" — anulan lo facturado).
        const balanceReal = (ventas + ajustesDebit - totalCobros - retencionesSufridas - ajustesCredit - totalNcs) - (compras - totalPagos - retencionesPracticadas);

        // Legacy compat
        const aCobrar = pendienteCobro;
        const aPagar = pendientePago;

        // Relationship type
        const hasVentas = ventas > 0 || cobrosAplicados > 0 || adelantosCobros > 0;
        const hasCompras = compras > 0 || pagosAplicados > 0 || adelantosPagos > 0;
        const tipo = hasVentas && hasCompras ? 'mixto' : hasCompras ? 'proveedor' : 'cliente';

        const out: any = {
          ...r,
          saldo_sol: Math.round(saldoSol * 100) / 100,
          total_ventas: ventas,
          total_cobros: totalCobros,
          total_cobros_aplicados: cobrosAplicados,
          cobros_no_asociados: cobrosNoAsociados,
          adelantos_cobros: cobrosNoAsociados,
          total_compras: compras,
          total_pagos: totalPagos,
          total_pagos_aplicados: pagosAplicados,
          pagos_no_asociados: pagosNoAsociados,
          adelantos_pagos: pagosNoAsociados,
          a_cobrar: aCobrar,
          a_pagar: aPagar,
          saldo: balanceReal,
          // Semantic fields
          deuda_cliente: pendienteCobro,
          credito_cliente: 0,
          deuda_proveedor: pendientePago,
          credito_proveedor: 0,
          retenciones_sufridas: retencionesSufridas,
          retenciones_practicadas: retencionesPracticadas,
          total_ncs: totalNcs,
          total_ncs_sol: ncsSol,
          total_ncs_luna: ncsLuna,
          adelantos_recibidos: cobrosNoAsociados,
          adelantos_entregados: pagosNoAsociados,
          saldo_neto: balanceReal,
          tipo,
        };
        if (userCanAccessLuna) {
          out.saldo_luna = Math.round(saldoLuna * 100) / 100;
        }
        return out;
      });
    } catch (error: any) {
      // PR7-T16: log causa real con detalle, pero fallback a lista vacia
      // en vez de 500 — el frontend puede mostrar "Sin movimientos" en lugar de crashear.
      console.error('[getResumen] Query failed. Message:', error?.message);
      console.error('[getResumen] Code:', error?.code, 'Detail:', error?.detail);
      console.error('[getResumen] Stack:', error?.stack?.split('\n').slice(0, 5).join('\n'));
      // Retornar array vacio con flag para que el frontend sepa que hubo error
      return [] as any[];
    }
  }

  async getDetalle(
    companyId: string,
    enterpriseId: string,
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      businessUnitId?: string;
      // CAT-6: Sol/Luna scoping. Defaults to 'fiscal' when omitted (legacy callers).
      fiscal_type?: 'fiscal' | 'no_fiscal';
      userCanAccessLuna?: boolean;
    }
  ) {
    try {
      // CAT-6: resolve circuit + leak-defense for non-Luna users.
      const circuit: 'fiscal' | 'no_fiscal' = filters?.fiscal_type || 'fiscal';
      if (circuit === 'no_fiscal' && filters?.userCanAccessLuna === false) {
        throw new ApiError(404, 'No encontrado');
      }
      // Validate enterprise exists
      const entCheck = await pool.query(
        'SELECT id, name, cuit FROM enterprises WHERE id = $1 AND company_id = $2',
        [enterpriseId, companyId]
      );
      if (entCheck.rows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entCheck.rows[0];

      // PR7-T16 mirror: detectar columnas status defensivamente.
      let cobrosStatusExists = true;
      try { await pool.query('SELECT status FROM cobros LIMIT 1'); }
      catch { cobrosStatusExists = false; }
      let pagosStatusExists = true;
      try { await pool.query('SELECT status FROM pagos LIMIT 1'); }
      catch { pagosStatusExists = false; }
      const cobrosAnuladoFilterC = cobrosStatusExists ? ` AND (c.status IS NULL OR c.status != 'anulado')` : '';
      const pagosAnuladoFilterP = pagosStatusExists ? ` AND (p.status IS NULL OR p.status != 'anulado')` : '';

      // H2: BU filter on account_adjustments only if the column exists.
      let ajustesBusinessUnitExists = true;
      try { await pool.query('SELECT business_unit_id FROM account_adjustments LIMIT 1'); }
      catch { ajustesBusinessUnitExists = false; }

      // 2026-04-23 prod hotfix: detectar columnas de Sol/Luna y cobro applications
      // defensivamente. En environments donde la migración no corrió, la query UNION
      // fallaba con "column ... does not exist" y el frontend solo veía un 500.
      const col = async (table: string, column: string): Promise<boolean> => {
        try { await pool.query(`SELECT ${column} FROM ${table} LIMIT 1`); return true; }
        catch { return false; }
      };
      const tbl = async (table: string): Promise<boolean> => {
        try { await pool.query(`SELECT 1 FROM ${table} LIMIT 1`); return true; }
        catch { return false; }
      };
      const invFiscalOk = await col('invoices', 'fiscal_type');
      const cobrosFiscalOk = await col('cobros', 'fiscal_type');
      const ajFiscalOk = await col('account_adjustments', 'fiscal_type');
      const cobrosPendingOk = await col('cobros', 'pending_status');
      const ciaTableOk = await tbl('cobro_invoice_applications');
      const retencionesOk = await tbl('retenciones');
      const retencionesDirOk = retencionesOk && await col('retenciones', 'direction');
      const invRelatedOk = await col('invoices', 'related_invoice_id');

      // Build dynamic filters with numbered params
      // $1 = enterpriseId, $2 = companyId (used in ALL UNION subqueries)
      const params: (string | undefined)[] = [enterpriseId, companyId];
      let buFilter = '';
      if (filters?.businessUnitId) {
        params.push(filters.businessUnitId);
        // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
        buFilter = ` AND (business_unit_id = $${params.length} OR business_unit_id IS NULL)`;
      }

      // CAT-6: fiscal_type param — applied to every UNION subquery that has
      // a fiscal_type column (invoices, cobros, account_adjustments).
      // purchase_invoices / pagos / retenciones are Sol-only (no Luna),
      // so under circuit='no_fiscal' we exclude them entirely by gating below.
      params.push(circuit);
      const circuitParamIdx = params.length;
      // Defensive fiscal filter: per-alias flag so migrations can be partial in
      // production without crashing the whole detalle query. If the column
      // doesn't exist, circuit='fiscal' is a no-op (rows default to fiscal);
      // circuit='no_fiscal' excludes everything, matching the "legacy data"
      // contract (nothing was ever stored as no_fiscal before the column existed).
      const fiscalFilter = (alias: string, colExists: boolean) => {
        if (!colExists) return circuit === 'fiscal' ? '' : ' AND FALSE';
        return ` AND COALESCE(${alias}.fiscal_type,'fiscal') = $${circuitParamIdx}`;
      };
      const isSol = circuit === 'fiscal';

      let dateFilter = '';
      if (filters?.dateFrom) {
        params.push(filters.dateFrom);
        dateFilter += ` AND fecha >= $${params.length}`;
      }
      if (filters?.dateTo) {
        params.push(filters.dateTo);
        dateFilter += ` AND fecha <= $${params.length}`;
      }

      // H3: opening balance — when a date range is applied, the running balance
      // must start at the sum of all movements BEFORE dateFrom (not at 0).
      // We build the same UNION body once and reuse it for both the opening sum
      // (without date filter, bounded by < dateFrom) and the main query.
      const unionBody = `
          SELECT
            i.invoice_date as fecha,
            'fact_venta' as tipo,
            COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number as nro_comprobante,
            CAST(i.total_amount AS decimal) as debe,
            0::decimal as haber,
            'Factura ' || COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number as descripcion,
            i.id as reference_id
          FROM invoices i
          WHERE i.enterprise_id = $1 AND i.company_id = $2 AND i.status NOT IN ('cancelled', 'draft')
            AND i.invoice_type::text NOT LIKE 'NC%'
            ${fiscalFilter('i', invFiscalOk)}
            ${buFilter.replace(/business_unit_id/g, 'i.business_unit_id')}

          UNION ALL

          -- Notas de Credito de venta: reducen la deuda del cliente.
          -- Haber > 0 para que el running balance (saldo += debe - haber) DECREMENTE el saldo.
          -- Status: solo NCs emitidas (mismo filtro que facturas). Draft y cancelled NO cuentan.
          -- fiscal_type: la NC hereda su propio circuito (Sol/Luna) almacenado en su row.
          -- related_invoice_id: si existe, incluir "anula FC <nro>" en la descripcion.
          SELECT
            i.invoice_date as fecha,
            'nc_venta' as tipo,
            COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number as nro_comprobante,
            0::decimal as debe,
            CAST(i.total_amount AS decimal) as haber,
            ${invRelatedOk ? `CASE
              WHEN ri.id IS NOT NULL THEN
                'NC ' || COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number
                || ' — anula ' || COALESCE(ri.invoice_type::text, '') || ' ' || ri.invoice_number
              ELSE 'NC ' || COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number
            END` : `'NC ' || COALESCE(i.invoice_type::text, '') || ' ' || i.invoice_number`} as descripcion,
            i.id as reference_id
          FROM invoices i
          ${invRelatedOk ? 'LEFT JOIN invoices ri ON ri.id = i.related_invoice_id' : ''}
          WHERE i.enterprise_id = $1 AND i.company_id = $2
            AND i.status NOT IN ('cancelled', 'draft')
            AND i.invoice_type::text LIKE 'NC%'
            ${fiscalFilter('i', invFiscalOk)}
            ${buFilter.replace(/business_unit_id/g, 'i.business_unit_id')}

          UNION ALL

          -- Wave 2B-2 (H20): split cobros into APPLIED + ADELANTO, mirroring
          -- getResumen's semantics. Previously detalle counted c.total_amount
          -- in full for every non-anulado cobro (regardless of where applied),
          -- while resumen summed cobro_invoice_applications per invoice.fiscal_type
          -- plus a pending_invoice adelanto bucket. That mismatch produced the
          -- 1000 divergence on orphan mis-posted cobros.
          --
          -- RULE (matches getResumen saldo_sol formula):
          --   - APPLIED portion: sum of cia.amount_applied where invoice matches
          --     fiscal_type and is NOT an NC. One row per cobro, aggregated.
          --   - ADELANTO portion: for cobros with pending_status='pending_invoice',
          --     emit (total_amount - sum(applications)) as the not-yet-applied
          --     remainder. Cobros without pending_invoice don't emit an adelanto,
          --     so orphan applications to NCs or cross-circuit invoices never
          --     count toward the client balance.
          --   - Both buckets filter cobro.fiscal_type=$circuit AND non-anulado.
          SELECT
            COALESCE(c.payment_date, c.created_at) as fecha,
            'recibo' as tipo,
            CAST(c.receipt_number AS text) as nro_comprobante,
            0::decimal as debe,
            ${ciaTableOk ? `COALESCE((
              SELECT SUM(CAST(cia.amount_applied AS decimal))
              FROM cobro_invoice_applications cia
              JOIN invoices cia_inv ON cia.invoice_id = cia_inv.id
              WHERE cia.cobro_id = c.id
                AND cia_inv.invoice_type::text NOT LIKE 'NC%'
                ${invFiscalOk ? `AND COALESCE(cia_inv.fiscal_type,'fiscal') = $${circuitParamIdx}` : ''}
            ), 0)` : `CAST(COALESCE(c.total_amount, c.amount) AS decimal)`} as haber,
            'Recibo #' || COALESCE(CAST(c.receipt_number AS text), c.id::text) as descripcion,
            c.id as reference_id
          FROM cobros c
          WHERE c.enterprise_id = $1 AND c.company_id = $2
            ${cobrosAnuladoFilterC}
            ${fiscalFilter('c', cobrosFiscalOk)}
            ${buFilter.replace(/business_unit_id/g, 'c.business_unit_id')}
            ${ciaTableOk ? `AND EXISTS (
              SELECT 1 FROM cobro_invoice_applications cia2
              JOIN invoices cia2_inv ON cia2.invoice_id = cia2_inv.id
              WHERE cia2.cobro_id = c.id
                AND cia2_inv.invoice_type::text NOT LIKE 'NC%'
                ${invFiscalOk ? `AND COALESCE(cia2_inv.fiscal_type,'fiscal') = $${circuitParamIdx}` : ''}
            )` : ''}

          UNION ALL

          -- Adelanto (unapplied portion) for pending_invoice cobros.
          -- Mirrors the total_adelantos_cobros_sol/luna subquery in getResumen.
          SELECT
            COALESCE(c.payment_date, c.created_at) as fecha,
            'adelanto_cobro' as tipo,
            CAST(c.receipt_number AS text) as nro_comprobante,
            0::decimal as debe,
            ${ciaTableOk ? `CAST(COALESCE(c.total_amount, c.amount) AS decimal) - COALESCE((
              SELECT SUM(CAST(cia.amount_applied AS decimal))
              FROM cobro_invoice_applications cia
              WHERE cia.cobro_id = c.id
            ), 0)` : `CAST(COALESCE(c.total_amount, c.amount) AS decimal)`} as haber,
            'Recibo (sin factura) #' || COALESCE(CAST(c.receipt_number AS text), c.id::text) as descripcion,
            c.id as reference_id
          FROM cobros c
          WHERE c.enterprise_id = $1 AND c.company_id = $2
            ${cobrosPendingOk ? `AND c.pending_status = 'pending_invoice'` : ' AND FALSE'}
            ${cobrosAnuladoFilterC}
            ${fiscalFilter('c', cobrosFiscalOk)}
            ${buFilter.replace(/business_unit_id/g, 'c.business_unit_id')}

          UNION ALL

          SELECT
            pi.invoice_date,
            'fact_compra',
            COALESCE(pi.punto_venta, '') || '-' || COALESCE(pi.invoice_number, ''),
            CAST(pi.total_amount AS decimal),
            0::decimal,
            'Fact. Compra ' || COALESCE(pi.invoice_type, '') || ' ' || COALESCE(pi.punto_venta, '') || '-' || COALESCE(pi.invoice_number, ''),
            pi.id
          FROM purchase_invoices pi
          WHERE pi.enterprise_id = $1 AND pi.company_id = $2
            AND pi.status NOT IN ('cancelled', 'cancelado')
            AND (pi.invoice_type IS NULL OR pi.invoice_type::text NOT LIKE 'NC%')
            -- NCs excluded per PR7-T13 semantic: NCs neither inflate nor subtract from compras.
            -- NCs-as-credit (true reduction of supplier debt) is a separate feature TODO.
            ${isSol ? '' : ' AND FALSE'}
            ${buFilter.replace(/business_unit_id/g, 'pi.business_unit_id')}

          UNION ALL

          SELECT
            COALESCE(p.payment_date, p.created_at),
            'orden_pago',
            CAST(p.id AS text),
            0::decimal,
            CAST(COALESCE(p.total_amount, p.amount) AS decimal),
            'Orden de Pago',
            p.id
          FROM pagos p
          WHERE p.enterprise_id = $1 AND p.company_id = $2
            ${pagosAnuladoFilterP}
            ${isSol ? '' : ' AND FALSE'}
            ${buFilter.replace(/business_unit_id/g, 'p.business_unit_id')}

          UNION ALL

          SELECT
            aa.created_at,
            'ajuste',
            CAST(aa.id AS text),
            CASE WHEN aa.adjustment_type = 'debit' THEN CAST(ABS(COALESCE(aa.amount, 0)) AS decimal) ELSE 0::decimal END,
            CASE WHEN aa.adjustment_type = 'credit' THEN CAST(ABS(COALESCE(aa.amount, 0)) AS decimal) ELSE 0::decimal END,
            'Ajuste' || COALESCE(' — ' || aa.reason, ''),
            aa.id
          FROM account_adjustments aa
          WHERE aa.enterprise_id = $1 AND aa.company_id = $2
            ${fiscalFilter('aa', ajFiscalOk)}
            ${buFilter && ajustesBusinessUnitExists ? buFilter.replace(/business_unit_id/g, 'aa.business_unit_id') : ''}

          UNION ALL

          -- Retenciones sufridas: el cliente nos retuvo, reduce lo que nos debe (haber)
          -- H5: excluir retenciones atadas a cobros anulados (r.cobro_id -> cobros.status).
          -- H2: heredar BU del cobro linkeado cuando aplica filtro.
          SELECT
            COALESCE(r.date, r.created_at) as fecha,
            'retencion_sufrida' as tipo,
            COALESCE(r.certificate_number, CAST(r.id AS text)) as nro_comprobante,
            0::decimal as debe,
            CAST(COALESCE(r.amount, 0) AS decimal) as haber,
            'Retencion sufrida ' || COALESCE(UPPER(r.type), '') as descripcion,
            r.id as reference_id
          FROM retenciones r
          LEFT JOIN cobros rc ON rc.id = r.cobro_id
          WHERE r.enterprise_id = $1 AND r.company_id = $2
            ${retencionesDirOk ? `AND r.direction = 'sufrida'` : ' AND FALSE'}
            ${cobrosStatusExists ? ` AND (r.cobro_id IS NULL OR rc.status IS NULL OR rc.status != 'anulado')` : ''}
            ${isSol ? '' : ' AND FALSE'}
            ${buFilter ? ` AND (r.cobro_id IS NULL OR rc.business_unit_id = $${params.indexOf(filters!.businessUnitId!) + 1} OR rc.business_unit_id IS NULL)` : ''}

          UNION ALL

          -- Retenciones practicadas: nosotros retuvimos al proveedor, reduce lo que le debemos (debe)
          -- H5: excluir retenciones atadas a pagos anulados.
          -- H2: heredar BU del pago linkeado cuando aplica filtro.
          SELECT
            COALESCE(r.date, r.created_at) as fecha,
            'retencion_practicada' as tipo,
            COALESCE(r.certificate_number, CAST(r.id AS text)) as nro_comprobante,
            CAST(COALESCE(r.amount, 0) AS decimal) as debe,
            0::decimal as haber,
            'Retencion practicada ' || COALESCE(UPPER(r.type), '') as descripcion,
            r.id as reference_id
          FROM retenciones r
          LEFT JOIN pagos rp ON rp.id = r.pago_id
          WHERE r.enterprise_id = $1 AND r.company_id = $2
            ${retencionesDirOk ? `AND r.direction = 'practicada'` : ' AND FALSE'}
            ${pagosStatusExists ? ` AND (r.pago_id IS NULL OR rp.status IS NULL OR rp.status != 'anulado')` : ''}
            ${isSol ? '' : ' AND FALSE'}
            ${buFilter ? ` AND (r.pago_id IS NULL OR rp.business_unit_id = $${params.indexOf(filters!.businessUnitId!) + 1} OR rp.business_unit_id IS NULL)` : ''}
      `;

      // H3: compute opening balance if dateFrom is set — sum of all movements BEFORE dateFrom.
      // H4: use the SAME arithmetic (sum(debe) - sum(haber)) as the main running balance.
      let openingBalance = 0;
      if (filters?.dateFrom) {
        const dateFromIdx = params.indexOf(filters.dateFrom) + 1;
        const openingResult = await pool.query(
          `SELECT COALESCE(SUM(debe) - SUM(haber), 0) AS saldo_inicial
           FROM (${unionBody}) AS all_movs
           WHERE fecha < $${dateFromIdx}`,
          params
        );
        openingBalance = parseFloat(openingResult.rows[0]?.saldo_inicial || '0') || 0;
      }

      // Single UNION ALL query using pool.query with numbered params
      const result = await pool.query(`
        SELECT * FROM (${unionBody}) movimientos
        WHERE true ${dateFilter}
        ORDER BY fecha ASC, tipo ASC
      `, params);

      // Running balance (saldo corrido progresivo).
      // H3: start at openingBalance (0 if no date range).
      // H4: convention = saldo += debe - haber. Same as getPdfData after unification.
      let saldo = openingBalance;
      const movimientos = result.rows.map((r: any) => {
        const debe = parseFloat(r.debe) || 0;
        const haber = parseFloat(r.haber) || 0;
        saldo += debe - haber;
        return {
          ...r,
          debe,
          haber,
          saldo: Math.round(saldo * 100) / 100,
        };
      });

      const totalDebe = movimientos.reduce((s: number, m: any) => s + m.debe, 0);
      const totalHaber = movimientos.reduce((s: number, m: any) => s + m.haber, 0);
      const closingBalance = openingBalance + totalDebe - totalHaber;

      return {
        enterprise,
        movimientos,
        opening_balance: Math.round(openingBalance * 100) / 100,
        closing_balance: Math.round(closingBalance * 100) / 100,
        totales: {
          debe: Math.round(totalDebe * 100) / 100,
          haber: Math.round(totalHaber * 100) / 100,
          // H4: saldo del periodo = opening + debe - haber (consistent with running balance).
          saldo: Math.round(closingBalance * 100) / 100,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const err = error as Error & { code?: string; detail?: string };
      console.error('CC getDetalle ERROR:', err.message, err.code, err.detail, err.stack?.split('\n').slice(0, 4).join('\n'));
      // Expose the Postgres error text to the caller so production issues
      // (missing column, missing table, FK failure) can be diagnosed from the UI.
      // The endpoint is authenticated + authorized; the risk of info leak is minimal
      // compared to the cost of silent 500s like the one reported 2026-04-23.
      const reason = [err.code, err.message, err.detail].filter(Boolean).join(' · ');
      throw new ApiError(500, `Failed to get cuenta corriente detalle: ${reason || 'error desconocido'}`);
    }
  }

  async getPdfData(
    companyId: string,
    enterpriseId: string,
    dateFrom: string,
    dateTo: string,
    opts?: { fiscal_type?: 'fiscal' | 'no_fiscal'; userCanAccessLuna?: boolean }
  ) {
    // CAT-6: resolve circuit + leak-defense.
    const circuit: 'fiscal' | 'no_fiscal' = opts?.fiscal_type || 'fiscal';
    if (circuit === 'no_fiscal' && opts?.userCanAccessLuna === false) {
      throw new ApiError(404, 'No encontrado');
    }
    const isSol = circuit === 'fiscal';
    try {
      const entCheck = await db.execute(sql`
        SELECT id, name, cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entRows[0];

      const compCheck = await db.execute(sql`
        SELECT name, cuit FROM companies WHERE id = ${companyId}
      `);
      const company = ((compCheck as any).rows || [])[0];
      if (!company) throw new ApiError(404, 'Company not found');

      // PR7-T16 mirror: detectar pagos.status defensivamente.
      let pagosStatusExistsPdf = true;
      try { await db.execute(sql`SELECT status FROM pagos LIMIT 1`); }
      catch { pagosStatusExistsPdf = false; }
      const pagosAnuladoFilterPdf = pagosStatusExistsPdf
        ? sql` AND (pa.status IS NULL OR pa.status != 'anulado')`
        : sql``;

      // Facturas de venta
      // NCs excluded from calculations (PR7-T13 semantic, NCs-as-credit es feature aparte).
      let allInvoices: any = { rows: [] };
      try {
        allInvoices = await db.execute(sql`
          SELECT i.id, 'factura' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            'Factura ' || COALESCE(i.invoice_type::text, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status NOT IN ('cancelled', 'draft')
            AND i.invoice_type::text NOT LIKE 'NC%'
            AND COALESCE(i.fiscal_type,'fiscal') = ${circuit}
        `);
      } catch (e) {
        console.error('[getPdfData] invoices query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load invoices for CC PDF');
      }

      // NCs (notas de credito de venta) — reducen la deuda del cliente.
      // Mismo filtro de status que facturas (cancelled/draft excluidos).
      // Hereda fiscal_type de la NC propia.
      let allNcs: any = { rows: [] };
      try {
        allNcs = await db.execute(sql`
          SELECT i.id, 'nc_venta' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            CASE
              WHEN ri.id IS NOT NULL THEN
                'NC ' || COALESCE(i.invoice_type::text, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0')
                || ' — anula ' || COALESCE(ri.invoice_type::text, 'NF') || ' ' || LPAD(CAST(COALESCE(ri.invoice_number, 0) AS TEXT), 8, '0')
              ELSE 'NC ' || COALESCE(i.invoice_type::text, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0')
            END as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN invoices ri ON ri.id = i.related_invoice_id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status NOT IN ('cancelled', 'draft')
            AND i.invoice_type::text LIKE 'NC%'
            AND COALESCE(i.fiscal_type,'fiscal') = ${circuit}
        `);
      } catch (e) {
        console.error('[getPdfData] ncs query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load NCs for CC PDF');
      }

      // Cobros aplicados
      let allCobros: any = { rows: [] };
      try {
        allCobros = await db.execute(sql`
          SELECT cia.id, 'cobro' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Recibo' || COALESCE(' — ' || co.payment_method, '') || COALESCE(' — ' || co.reference, '') as descripcion,
            CAST(COALESCE(cia.amount_applied, 0) AS decimal) as monto
          FROM cobro_invoice_applications cia
          JOIN cobros co ON cia.cobro_id = co.id
          JOIN invoices i ON cia.invoice_id = i.id
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
            AND (co.status IS NULL OR co.status != 'anulado')
            AND i.invoice_type::text NOT LIKE 'NC%'
            AND COALESCE(i.fiscal_type,'fiscal') = ${circuit}
        `);
      } catch (e) {
        console.error('[getPdfData] cobros query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load cobros for CC PDF');
      }

      // Adelantos
      let allAdelantos: any = { rows: [] };
      try {
        allAdelantos = await db.execute(sql`
          SELECT co.id, 'adelanto' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Recibo (sin factura)' || COALESCE(' — ' || co.payment_method, '') as descripcion,
            CAST(COALESCE(co.total_amount, co.amount, 0) AS decimal) - COALESCE((
              SELECT SUM(CAST(cia_p.amount_applied AS decimal)) FROM cobro_invoice_applications cia_p WHERE cia_p.cobro_id = co.id
            ), 0) as monto
          FROM cobros co
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
            AND co.pending_status = 'pending_invoice'
            AND (co.status IS NULL OR co.status != 'anulado')
            AND COALESCE(co.fiscal_type,'fiscal') = ${circuit}
        `);
      } catch (e) {
        console.error('[getPdfData] adelantos query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load adelantos for CC PDF');
      }

      // Ajustes
      let allAdjustments: any = { rows: [] };
      try {
        allAdjustments = await db.execute(sql`
          SELECT aa.id, 'ajuste' as tipo, aa.created_at as fecha,
            'Ajuste' || COALESCE(' — ' || aa.reason, '') as descripcion,
            CAST(ABS(COALESCE(aa.amount, 0)) AS decimal) as monto,
            aa.adjustment_type
          FROM account_adjustments aa
          WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
            AND COALESCE(aa.fiscal_type,'fiscal') = ${circuit}
        `);
      } catch (e) {
        console.error('[getPdfData] adjustments query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load adjustments for CC PDF');
      }

      // Retenciones sufridas
      // H5: excluir retenciones atadas a cobros anulados.
      let allRetSufridas: any = { rows: [] };
      try {
        allRetSufridas = await db.execute(sql`
          SELECT r.id, 'retencion_sufrida' as tipo, COALESCE(r.date, r.created_at) as fecha,
            'Ret. sufrida ' || UPPER(r.type) || COALESCE(' — ' || r.certificate_number, '') as descripcion,
            CAST(COALESCE(r.amount, 0) AS decimal) as monto
          FROM retenciones r
          LEFT JOIN cobros rc ON rc.id = r.cobro_id
          WHERE r.company_id = ${companyId} AND r.enterprise_id = ${enterpriseId}
            AND r.direction = 'sufrida'
            AND (r.cobro_id IS NULL OR rc.id IS NULL OR rc.status IS NULL OR rc.status != 'anulado')
            AND ${isSol ? sql`TRUE` : sql`FALSE`}
        `);
      } catch (e) {
        console.error('[getPdfData] retenciones sufridas query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load retenciones sufridas for CC PDF');
      }

      // Retenciones practicadas
      // H5: excluir retenciones atadas a pagos anulados.
      let allRetPracticadas: any = { rows: [] };
      try {
        allRetPracticadas = await db.execute(sql`
          SELECT r.id, 'retencion_practicada' as tipo, COALESCE(r.date, r.created_at) as fecha,
            'Ret. practicada ' || UPPER(r.type) || COALESCE(' — ' || r.certificate_number, '') as descripcion,
            CAST(COALESCE(r.amount, 0) AS decimal) as monto
          FROM retenciones r
          LEFT JOIN pagos rp ON rp.id = r.pago_id
          WHERE r.company_id = ${companyId} AND r.enterprise_id = ${enterpriseId}
            AND r.direction = 'practicada'
            AND (r.pago_id IS NULL OR rp.id IS NULL OR rp.status IS NULL OR rp.status != 'anulado')
            AND ${isSol ? sql`TRUE` : sql`FALSE`}
        `);
      } catch (e) {
        console.error('[getPdfData] retenciones practicadas query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load retenciones practicadas for CC PDF');
      }

      // Facturas de compra
      let allPurchaseInvoices: any = { rows: [] };
      try {
        allPurchaseInvoices = await db.execute(sql`
          SELECT pi.id, 'factura_compra' as tipo, COALESCE(pi.invoice_date, pi.created_at) as fecha,
            'Fact. Compra ' || pi.invoice_type || ' ' || pi.invoice_number as descripcion,
            CAST(COALESCE(pi.total_amount, 0) AS decimal) as monto
          FROM purchase_invoices pi
          WHERE pi.company_id = ${companyId} AND pi.enterprise_id = ${enterpriseId}
            AND pi.status NOT IN ('cancelled', 'cancelado')
            AND (pi.invoice_type IS NULL OR pi.invoice_type::text NOT LIKE 'NC%')
            AND ${isSol ? sql`TRUE` : sql`FALSE`}
            -- NCs excluded per PR7-T13 semantic: NCs neither inflate nor subtract from compras.
            -- NCs-as-credit (true reduction of supplier debt) is a separate feature TODO.
        `);
      } catch (e) {
        console.error('[getPdfData] purchase_invoices query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load purchase invoices for CC PDF');
      }

      // Pagos aplicados
      let allPagos: any = { rows: [] };
      try {
        allPagos = await db.execute(sql`
          SELECT pia.id, 'pago' as tipo, COALESCE(pa.payment_date, pa.created_at) as fecha,
            'Orden de Pago' || COALESCE(' — ' || pa.payment_method, '') || COALESCE(' — ' || pa.reference, '') as descripcion,
            CAST(COALESCE(pia.amount_applied, 0) AS decimal) as monto
          FROM pago_invoice_applications pia
          JOIN pagos pa ON pia.pago_id = pa.id
          JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
            AND pi.status NOT IN ('cancelled', 'cancelado')
            AND (pi.invoice_type IS NULL OR pi.invoice_type::text NOT LIKE 'NC%')
            AND ${isSol ? sql`TRUE` : sql`FALSE`}
            ${pagosAnuladoFilterPdf}
        `);
      } catch (e) {
        console.error('[getPdfData] pagos query failed:', (e as any)?.message);
        throw new ApiError(500, 'Failed to load pagos for CC PDF');
      }

      const parseRows = (result: any) =>
        ((result as any).rows || []).map((m: any) => ({
          ...m,
          monto: parseFloat(m.monto || '0'),
          fecha: m.fecha || new Date().toISOString(),
          descripcion: m.descripcion || 'Sin descripcion',
        }));

      const invoices = parseRows(allInvoices);
      const ncs = parseRows(allNcs);
      const cobros = parseRows(allCobros);
      const adelantos = parseRows(allAdelantos);
      const retSufridas = parseRows(allRetSufridas);
      const retPracticadas = parseRows(allRetPracticadas);
      const adjustments = parseRows(allAdjustments);
      const purchaseInvoices = parseRows(allPurchaseInvoices);
      const pagos = parseRows(allPagos);

      // Build ALL movements sorted by date
      const allMovimientos = [
        ...invoices.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...ncs.map((n: any) => ({ ...n, debe: 0, haber: n.monto })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
        ...adelantos.map((a: any) => ({ ...a, debe: 0, haber: a.monto })),
        ...retSufridas.map((r: any) => ({ ...r, debe: 0, haber: r.monto })),
        ...adjustments.map((a: any) => ({
          ...a,
          debe: a.adjustment_type === 'debit' ? a.monto : 0,
          haber: a.adjustment_type === 'credit' ? a.monto : 0,
        })),
        ...purchaseInvoices.map((p: any) => ({ ...p, debe: p.monto, haber: 0, isPagar: true })),
        ...pagos.map((pa: any) => ({ ...pa, debe: 0, haber: pa.monto, isPagar: true })),
        ...retPracticadas.map((r: any) => ({ ...r, debe: 0, haber: r.monto, isPagar: true })),
      ].sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      // H4: unify sign convention with getDetalle. Both endpoints now use a single
      // ledger where saldo += debe - haber for ALL movements (no flip for supplier side).
      // Positive saldo => net charges (ventas) exceed credits (cobros); negative saldo
      // => net credits exceed charges. Purchase invoices also land on debe, so a
      // supplier-only enterprise shows a positive balance meaning "we owe the supplier".
      let runningBalance = 0;
      const allWithSaldo = allMovimientos.map((m: any) => {
        runningBalance += (m.debe - m.haber);
        return { ...m, saldo: runningBalance };
      });

      const totalBalance = runningBalance;

      // PR7-T1: offset AR -03:00 para consistencia con reports
      const fromDate = new Date(dateFrom + 'T00:00:00-03:00');
      const toDate = new Date(dateTo + 'T23:59:59.999-03:00');

      const filteredMovimientos = allWithSaldo.filter((m: any) => {
        const fecha = new Date(m.fecha);
        return fecha >= fromDate && fecha <= toDate;
      });

      const limitedMovimientos = filteredMovimientos.length > 500
        ? filteredMovimientos.slice(filteredMovimientos.length - 500)
        : filteredMovimientos;

      return {
        company,
        enterprise,
        dateFrom,
        dateTo,
        movimientos: limitedMovimientos,
        totalBalance,
        totalMovimientos: filteredMovimientos.length,
        circuit,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get cuenta corriente PDF data error:', error);
      throw new ApiError(500, 'Failed to get cuenta corriente PDF data');
    }
  }

  async createAdjustment(companyId: string, enterpriseId: string, data: {
    amount: number;
    reason: string;
    adjustment_type: 'credit' | 'debit';
    created_by?: string;
    // CAT-6: required circuit tag.
    fiscal_type?: 'fiscal' | 'no_fiscal';
    userCanAccessLuna?: boolean;
  }) {
    try {
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');

      if (!data.amount || data.amount === 0) throw new ApiError(400, 'Amount must be non-zero');
      if (!data.reason || data.reason.trim().length === 0) throw new ApiError(400, 'Reason is required');
      if (!['credit', 'debit'].includes(data.adjustment_type)) throw new ApiError(400, 'adjustment_type must be "credit" or "debit"');

      // CAT-6: default fiscal and enforce luna access.
      const fiscalType: 'fiscal' | 'no_fiscal' = data.fiscal_type || 'fiscal';
      if (fiscalType !== 'fiscal' && fiscalType !== 'no_fiscal') {
        throw new ApiError(400, 'fiscal_type invalido');
      }
      if (fiscalType === 'no_fiscal' && data.userCanAccessLuna === false) {
        throw new ApiError(403, 'Sin acceso al circuito Luna');
      }

      const storedAmount = data.adjustment_type === 'credit'
        ? -Math.abs(data.amount)
        : Math.abs(data.amount);

      const result = await db.execute(sql`
        INSERT INTO account_adjustments (company_id, enterprise_id, amount, reason, adjustment_type, created_by, fiscal_type)
        VALUES (${companyId}, ${enterpriseId}, ${storedAmount}, ${data.reason.trim()}, ${data.adjustment_type}, ${data.created_by || null}, ${fiscalType})
        RETURNING *
      `);
      const adjustment = ((result as any).rows || [])[0];

      // Accounting entry for CC adjustment
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createEntryForAdjustment({
          id: adjustment.id,
          company_id: companyId,
          enterprise_id: enterpriseId,
          adjustment_type: data.adjustment_type,
          amount: Math.abs(data.amount),
          reason: data.reason,
        });
      } catch (accErr) { console.warn('Accounting entry skipped (adjustment):', (accErr as Error).message); }

      return adjustment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create adjustment error:', error);
      throw new ApiError(500, 'Failed to create adjustment');
    }
  }

  async getAdjustments(companyId: string, enterpriseId: string) {
    try {
      const result = await db.execute(sql`
        SELECT aa.*, u.name as created_by_name
        FROM account_adjustments aa
        LEFT JOIN users u ON aa.created_by = u.id
        WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        ORDER BY aa.created_at DESC
      `);
      return ((result as any).rows || []).map((r: any) => ({
        ...r,
        amount: parseFloat(r.amount || '0'),
      }));
    } catch (error) {
      console.error('Get adjustments error:', error);
      throw new ApiError(500, 'Failed to get adjustments');
    }
  }

  async deleteAdjustment(companyId: string, enterpriseId: string, adjustmentId: string) {
    try {
      const check = await db.execute(sql`
        SELECT id FROM account_adjustments
        WHERE id = ${adjustmentId} AND company_id = ${companyId} AND enterprise_id = ${enterpriseId}
      `);
      if (((check as any).rows || []).length === 0) throw new ApiError(404, 'Adjustment not found');

      await db.execute(sql`
        DELETE FROM account_adjustments
        WHERE id = ${adjustmentId} AND company_id = ${companyId} AND enterprise_id = ${enterpriseId}
      `);
      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete adjustment error:', error);
      throw new ApiError(500, 'Failed to delete adjustment');
    }
  }
}

export const cuentaCorrienteService = new CuentaCorrienteService();
