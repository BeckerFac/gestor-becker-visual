import React, { useState, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Product, Category, PriceListRule } from './types'

interface PriceListsManagerProps {
  priceLists: any[]
  products: Product[]
  categories?: Category[]
  onReload: () => void
}

type TabType = 'rules' | 'products' | 'bulk'

export const PriceListsManager: React.FC<PriceListsManagerProps> = ({ priceLists, products, categories = [], onReload }) => {
  const [plForm, setPlForm] = useState({ name: '', type: 'default' })
  const [plSaving, setPlSaving] = useState(false)
  const [expandedListId, setExpandedListId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('rules')
  const [rules, setRules] = useState<PriceListRule[]>([])
  const [resolvedPrices, setResolvedPrices] = useState<any[]>([])
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [enterprises, setEnterprises] = useState<any[]>([])

  // Rule form
  const [ruleForm, setRuleForm] = useState({
    scope: 'global' as 'global' | 'category' | 'product',
    product_id: '',
    category_id: '',
    rule_type: 'percentage' as 'percentage' | 'fixed' | 'formula',
    value: '',
    min_quantity: '1',
    priority: '0',
  })
  const [ruleSaving, setRuleSaving] = useState(false)

  // Bulk form
  const [bulkType, setBulkType] = useState<'increase_percent' | 'copy_from_list'>('increase_percent')
  const [bulkPercent, setBulkPercent] = useState('')
  const [bulkSourceList, setBulkSourceList] = useState('')
  const [bulkMarkup, setBulkMarkup] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  const handleCreatePriceList = async () => {
    if (!plForm.name.trim()) return
    setPlSaving(true)
    try {
      await api.createPriceList({ name: plForm.name.trim(), type: plForm.type })
      setPlForm({ name: '', type: 'default' })
      await onReload()
      toast.success('Lista de precios creada')
    } catch (e: any) { toast.error(e.message) }
    finally { setPlSaving(false) }
  }

  const handleDeletePriceList = async (listId: string) => {
    try {
      await api.deletePriceList(listId)
      if (expandedListId === listId) { setExpandedListId(null); setRules([]); setResolvedPrices([]) }
      await onReload()
      toast.success('Lista de precios eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  const loadListDetails = useCallback(async (listId: string) => {
    try {
      const detail = await api.getPriceList(listId)
      setRules(detail.rules || [])
      setEnterprises(detail.enterprises || [])
    } catch (e: any) { toast.error(e.message) }
  }, [])

  const handleExpandPriceList = async (listId: string) => {
    if (expandedListId === listId) { setExpandedListId(null); setRules([]); setResolvedPrices([]); return }
    setExpandedListId(listId)
    setActiveTab('rules')
    await loadListDetails(listId)
  }

  const loadResolvedPrices = async (listId: string) => {
    setLoadingPrices(true)
    try {
      const data = await api.resolveAllPrices(listId)
      setResolvedPrices(data || [])
    } catch (e: any) { toast.error(e.message) }
    finally { setLoadingPrices(false) }
  }

  const handleTabChange = async (tab: TabType) => {
    setActiveTab(tab)
    if (tab === 'products' && expandedListId && resolvedPrices.length === 0) {
      await loadResolvedPrices(expandedListId)
    }
  }

  // --- Rules Management ---

  const handleAddRule = async () => {
    if (!expandedListId || !ruleForm.value) return
    setRuleSaving(true)
    try {
      await api.addPriceListRule(expandedListId, {
        product_id: ruleForm.scope === 'product' ? ruleForm.product_id || null : null,
        category_id: ruleForm.scope === 'category' ? ruleForm.category_id || null : null,
        rule_type: ruleForm.rule_type,
        value: parseFloat(ruleForm.value),
        min_quantity: parseInt(ruleForm.min_quantity) || 1,
        priority: parseInt(ruleForm.priority) || 0,
      })
      setRuleForm({ scope: 'global', product_id: '', category_id: '', rule_type: 'percentage', value: '', min_quantity: '1', priority: '0' })
      await loadListDetails(expandedListId)
      await onReload()
      toast.success('Regla agregada')
    } catch (e: any) { toast.error(e.message) }
    finally { setRuleSaving(false) }
  }

  const handleDeleteRule = async (ruleId: string) => {
    if (!expandedListId) return
    try {
      await api.deletePriceListRule(expandedListId, ruleId)
      await loadListDetails(expandedListId)
      await onReload()
      toast.success('Regla eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  // --- Bulk Operations ---

  const handleBulkApply = async () => {
    if (!expandedListId) return
    setBulkSaving(true)
    try {
      if (bulkType === 'increase_percent') {
        const pct = parseFloat(bulkPercent)
        if (!pct) { toast.error('Ingrese un porcentaje'); return }
        const result = await api.bulkUpdatePriceListRules(expandedListId, { type: 'increase_percent', percent: pct })
        toast.success(`${result.updated || 0} precios actualizados (${pct > 0 ? '+' : ''}${pct}%)`)
      } else if (bulkType === 'copy_from_list') {
        if (!bulkSourceList) { toast.error('Seleccione lista origen'); return }
        const result = await api.bulkUpdatePriceListRules(expandedListId, {
          type: 'copy_from_list',
          source_list_id: bulkSourceList,
          markup_percent: parseFloat(bulkMarkup) || 0,
        })
        toast.success(`${result.copied || 0} reglas copiadas`)
      }
      await loadListDetails(expandedListId)
      setResolvedPrices([])
      await onReload()
    } catch (e: any) { toast.error(e.message) }
    finally { setBulkSaving(false) }
  }

  const getRuleDescription = (rule: PriceListRule) => {
    const scope = rule.product_id ? `Producto: ${rule.product_name || rule.product_sku || 'N/A'}`
      : rule.category_id ? `Categoria: ${rule.category_name || 'N/A'}`
      : 'Todos los productos'

    const val = parseFloat(rule.value || '0')
    let typeDesc = ''
    if (rule.rule_type === 'percentage') {
      typeDesc = `${val > 0 ? '+' : ''}${val}%`
    } else if (rule.rule_type === 'fixed') {
      typeDesc = `Fijo: ${formatCurrency(val)}`
    } else if (rule.rule_type === 'formula') {
      typeDesc = `Costo x ${val}`
    }

    const qty = rule.min_quantity > 1 ? ` | qty >= ${rule.min_quantity}` : ''
    return { scope, typeDesc, qty }
  }

  const inputClass = 'px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100'
  const tabClass = (tab: TabType) => `px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${activeTab === tab ? 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 border border-b-0 border-gray-200 dark:border-gray-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Listas de precios ({priceLists.length})</h3>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <input placeholder="Nombre de la lista..." value={plForm.name} onChange={e => setPlForm({ ...plForm, name: e.target.value })} className={`${inputClass} flex-1`} />
          <select value={plForm.type} onChange={e => setPlForm({ ...plForm, type: e.target.value })} className={inputClass}>
            <option value="default">General</option>
            <option value="customer">Cliente</option>
            <option value="channel">Canal</option>
            <option value="promo">Promocion</option>
          </select>
          <Button variant="primary" onClick={handleCreatePriceList} loading={plSaving} disabled={!plForm.name.trim()}>+ Crear</Button>
        </div>

        {priceLists.length > 0 && (
          <div className="space-y-2">
            {priceLists.map((pl: any) => (
              <div key={pl.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors" onClick={() => handleExpandPriceList(pl.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs">{expandedListId === pl.id ? '▼' : '▶'}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{pl.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{pl.type}</span>
                    {Number(pl.rule_count) > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">{pl.rule_count} regla{Number(pl.rule_count) !== 1 ? 's' : ''}</span>
                    )}
                    {Number(pl.item_count) > 0 && (
                      <span className="text-gray-400 text-xs">{pl.item_count} precio{Number(pl.item_count) !== 1 ? 's' : ''} fijo{Number(pl.item_count) !== 1 ? 's' : ''}</span>
                    )}
                    {Number(pl.enterprise_count) > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{pl.enterprise_count} empresa{Number(pl.enterprise_count) !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeletePriceList(pl.id) }} className="text-red-500 dark:text-red-400 text-xs hover:underline">Eliminar</button>
                </div>

                {expandedListId === pl.id && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    {/* Tabs */}
                    <div className="flex gap-1 px-3 pt-2">
                      <button className={tabClass('rules')} onClick={() => handleTabChange('rules')}>Reglas</button>
                      <button className={tabClass('products')} onClick={() => handleTabChange('products')}>Precios Resueltos</button>
                      <button className={tabClass('bulk')} onClick={() => handleTabChange('bulk')}>Operaciones Masivas</button>
                    </div>

                    <div className="px-3 py-2 space-y-2">
                      {/* RULES TAB */}
                      {activeTab === 'rules' && (
                        <>
                          {/* Add rule form */}
                          <div className="bg-gray-50 dark:bg-gray-900/30 rounded p-2 space-y-2">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Nueva regla</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={ruleForm.scope} onChange={e => setRuleForm({ ...ruleForm, scope: e.target.value as any })} className={inputClass}>
                                <option value="global">Todos los productos</option>
                                <option value="category">Categoria</option>
                                <option value="product">Producto especifico</option>
                              </select>
                              {ruleForm.scope === 'product' && (
                                <select value={ruleForm.product_id} onChange={e => setRuleForm({ ...ruleForm, product_id: e.target.value })} className={`${inputClass} flex-1`}>
                                  <option value="">Seleccionar producto...</option>
                                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                                </select>
                              )}
                              {ruleForm.scope === 'category' && (
                                <select value={ruleForm.category_id} onChange={e => setRuleForm({ ...ruleForm, category_id: e.target.value })} className={`${inputClass} flex-1`}>
                                  <option value="">Seleccionar categoria...</option>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.parent_id ? '-- ' : ''}{c.name}</option>)}
                                </select>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={ruleForm.rule_type} onChange={e => setRuleForm({ ...ruleForm, rule_type: e.target.value as any })} className={inputClass}>
                                <option value="percentage">Porcentaje</option>
                                <option value="fixed">Precio fijo</option>
                                <option value="formula">Formula (costo x coef.)</option>
                              </select>
                              <input
                                type="number" step="0.01"
                                placeholder={ruleForm.rule_type === 'percentage' ? 'Ej: -15 para 15% desc' : ruleForm.rule_type === 'fixed' ? 'Precio' : 'Coeficiente'}
                                value={ruleForm.value}
                                onChange={e => setRuleForm({ ...ruleForm, value: e.target.value })}
                                className={`${inputClass} w-40`}
                              />
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-gray-500 dark:text-gray-400">Qty min:</label>
                                <input type="number" min="1" value={ruleForm.min_quantity} onChange={e => setRuleForm({ ...ruleForm, min_quantity: e.target.value })} className={`${inputClass} w-16`} />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-gray-500 dark:text-gray-400">Prioridad:</label>
                                <input type="number" value={ruleForm.priority} onChange={e => setRuleForm({ ...ruleForm, priority: e.target.value })} className={`${inputClass} w-16`} />
                              </div>
                              <Button variant="primary" onClick={handleAddRule} loading={ruleSaving} disabled={!ruleForm.value}>+ Agregar</Button>
                            </div>
                          </div>

                          {/* Rules list */}
                          {rules.length > 0 ? (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-500 dark:text-gray-400 text-xs border-b border-gray-200 dark:border-gray-700">
                                  <th className="pb-1 font-medium">Alcance</th>
                                  <th className="pb-1 font-medium">Tipo</th>
                                  <th className="pb-1 font-medium text-right">Valor</th>
                                  <th className="pb-1 font-medium text-center">Qty Min</th>
                                  <th className="pb-1 font-medium text-center">Prior.</th>
                                  <th className="pb-1 w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {rules.map((rule: PriceListRule) => {
                                  const desc = getRuleDescription(rule)
                                  return (
                                    <tr key={rule.id} className="border-b border-gray-100 dark:border-gray-700/50">
                                      <td className="py-1 text-gray-800 dark:text-gray-200 text-xs">{desc.scope}</td>
                                      <td className="py-1">
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                          rule.rule_type === 'percentage' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                          : rule.rule_type === 'fixed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                          : 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                        }`}>{rule.rule_type}</span>
                                      </td>
                                      <td className="py-1 text-right font-semibold text-gray-800 dark:text-gray-200">{desc.typeDesc}</td>
                                      <td className="py-1 text-center text-gray-500 dark:text-gray-400 text-xs">{rule.min_quantity > 1 ? `${rule.min_quantity}+` : '-'}</td>
                                      <td className="py-1 text-center text-gray-500 dark:text-gray-400 text-xs">{rule.priority}</td>
                                      <td className="py-1">
                                        <button onClick={() => handleDeleteRule(rule.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs">x</button>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-xs text-gray-400 text-center py-2">Sin reglas. Agrega una regla para definir precios.</p>
                          )}

                          {/* Assigned enterprises */}
                          {enterprises.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Empresas asignadas:</p>
                              <div className="flex flex-wrap gap-1">
                                {enterprises.map((ent: any) => (
                                  <span key={ent.id} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300">{ent.name}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* PRODUCTS TAB */}
                      {activeTab === 'products' && (
                        <>
                          {loadingPrices ? (
                            <p className="text-xs text-gray-400 text-center py-2">Calculando precios...</p>
                          ) : resolvedPrices.length > 0 ? (
                            <div className="overflow-x-auto max-h-[400px]">
                              <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white dark:bg-gray-800">
                                  <tr className="text-left text-gray-500 dark:text-gray-400 text-xs border-b border-gray-200 dark:border-gray-700">
                                    <th className="pb-1 font-medium">SKU</th>
                                    <th className="pb-1 font-medium">Producto</th>
                                    <th className="pb-1 font-medium text-right">P. Base</th>
                                    <th className="pb-1 font-medium text-right">P. Lista</th>
                                    <th className="pb-1 font-medium text-right">Desc %</th>
                                    <th className="pb-1 font-medium">Regla</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {resolvedPrices.map((rp: any) => (
                                    <tr key={rp.product_id} className="border-b border-gray-100 dark:border-gray-700/50">
                                      <td className="py-1 font-mono text-xs text-gray-500 dark:text-gray-400">{rp.product_sku}</td>
                                      <td className="py-1 text-gray-800 dark:text-gray-200">{rp.product_name}</td>
                                      <td className="py-1 text-right text-gray-400">{formatCurrency(rp.base_price)}</td>
                                      <td className="py-1 text-right font-semibold text-green-700 dark:text-green-400">{formatCurrency(rp.resolved_price)}</td>
                                      <td className="py-1 text-right">
                                        {rp.discount_percent !== 0 && (
                                          <span className={rp.discount_percent > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                                            {rp.discount_percent > 0 ? '-' : '+'}{Math.abs(rp.discount_percent).toFixed(1)}%
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1 text-xs text-gray-500 dark:text-gray-400">{rp.rule_applied || 'Sin regla'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 text-center py-2">Sin productos activos con precio base.</p>
                          )}
                        </>
                      )}

                      {/* BULK TAB */}
                      {activeTab === 'bulk' && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <select value={bulkType} onChange={e => setBulkType(e.target.value as any)} className={inputClass}>
                              <option value="increase_percent">Aumentar/disminuir porcentaje</option>
                              <option value="copy_from_list">Copiar de otra lista</option>
                            </select>
                          </div>

                          {bulkType === 'increase_percent' && (
                            <div className="flex items-center gap-2">
                              <input type="number" step="0.1" placeholder="Ej: 8 para +8%, -5 para -5%" value={bulkPercent} onChange={e => setBulkPercent(e.target.value)} className={`${inputClass} w-48`} />
                              <span className="text-xs text-gray-500 dark:text-gray-400">Aplica solo a precios fijos</span>
                              <Button variant="success" onClick={handleBulkApply} loading={bulkSaving} disabled={!bulkPercent}>Aplicar</Button>
                            </div>
                          )}

                          {bulkType === 'copy_from_list' && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={bulkSourceList} onChange={e => setBulkSourceList(e.target.value)} className={`${inputClass} flex-1`}>
                                <option value="">Seleccionar lista origen...</option>
                                {priceLists.filter((pl: any) => pl.id !== expandedListId).map((pl: any) => (
                                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-gray-500 dark:text-gray-400">Markup %:</label>
                                <input type="number" step="0.1" placeholder="0" value={bulkMarkup} onChange={e => setBulkMarkup(e.target.value)} className={`${inputClass} w-20`} />
                              </div>
                              <Button variant="success" onClick={handleBulkApply} loading={bulkSaving} disabled={!bulkSourceList}>Copiar</Button>
                            </div>
                          )}

                          <p className="text-xs text-gray-400">
                            {bulkType === 'increase_percent'
                              ? 'Actualiza precios fijos y items de la lista. Las reglas porcentuales se ajustan automaticamente cuando cambia el precio base.'
                              : 'Reemplaza todas las reglas de esta lista con las reglas de la lista origen, aplicando el markup indicado.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
