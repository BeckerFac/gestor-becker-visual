export interface Enterprise {
  id?: string
  name?: string | null
  razon_social?: string | null
  cuit?: string | null
  tax_condition?: string | null
  address?: string | null
  fiscal_address?: string | null
}

export interface FiscalCheckResult {
  complete: boolean
  missing: string[]
}

export function checkEnterpriseFiscalData(ent: Enterprise | null | undefined): FiscalCheckResult {
  if (!ent) return { complete: false, missing: ['empresa no seleccionada'] }
  const missing: string[] = []
  if (!ent.name?.trim()) missing.push('Nombre')
  if (!ent.razon_social?.trim()) missing.push('Razon social')
  if (!ent.tax_condition?.trim()) missing.push('Condicion IVA')
  const isConsumidorFinal = (ent.tax_condition || '').toLowerCase().includes('consumidor final')
  if (!isConsumidorFinal && !ent.cuit?.trim()) missing.push('CUIT')
  const hasFiscalAddress = ent.fiscal_address?.trim() || ent.address?.trim()
  if (!hasFiscalAddress) missing.push('Direccion fiscal')
  return { complete: missing.length === 0, missing }
}
