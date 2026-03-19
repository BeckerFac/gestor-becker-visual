import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Product } from './types'

interface PriceListsManagerProps {
  priceLists: any[]
  products: Product[]
  onReload: () => void
}

export const PriceListsManager: React.FC<PriceListsManagerProps> = ({ priceLists, products, onReload }) => {
  const [plForm, setPlForm] = useState({ name: '', type: 'default' })
  const [plSaving, setPlSaving] = useState(false)
  const [expandedListId, setExpandedListId] = useState<string | null>(null)
  const [expandedListItems, setExpandedListItems] = useState<any[]>([])
  const [plAddProduct, setPlAddProduct] = useState({ product_id: '', price: '', discount_percent: '0' })

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
      if (expandedListId === listId) { setExpandedListId(null); setExpandedListItems([]) }
      await onReload()
      toast.success('Lista de precios eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleExpandPriceList = async (listId: string) => {
    if (expandedListId === listId) { setExpandedListId(null); setExpandedListItems([]); return }
    try {
      const detail = await api.getPriceList(listId)
      setExpandedListItems(detail.items || [])
      setExpandedListId(listId)
    } catch (e: any) { toast.error(e.message) }
  }

  const handleAddProductToList = async () => {
    if (!expandedListId || !plAddProduct.product_id || !plAddProduct.price) return
    try {
      const newItems = [
        ...expandedListItems.map((it: any) => ({
          product_id: it.product_id,
          price: parseFloat(it.price),
          discount_percent: parseFloat(it.discount_percent || '0'),
        })),
        {
          product_id: plAddProduct.product_id,
          price: parseFloat(plAddProduct.price),
          discount_percent: parseFloat(plAddProduct.discount_percent || '0'),
        },
      ]
      const updated = await api.setPriceListItems(expandedListId, newItems)
      setExpandedListItems(updated || [])
      setPlAddProduct({ product_id: '', price: '', discount_percent: '0' })
      await onReload()
      toast.success('Producto agregado a la lista')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleRemoveProductFromList = async (productId: string) => {
    if (!expandedListId) return
    try {
      const newItems = expandedListItems
        .filter((it: any) => it.product_id !== productId)
        .map((it: any) => ({
          product_id: it.product_id,
          price: parseFloat(it.price),
          discount_percent: parseFloat(it.discount_percent || '0'),
        }))
      const updated = await api.setPriceListItems(expandedListId, newItems)
      setExpandedListItems(updated || [])
      await onReload()
      toast.success('Producto removido de la lista')
    } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Listas de precios ({priceLists.length})</h3>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <input placeholder="Nombre de la lista..." value={plForm.name} onChange={e => setPlForm({ ...plForm, name: e.target.value })} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
          <select value={plForm.type} onChange={e => setPlForm({ ...plForm, type: e.target.value })} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{expandedListId === pl.id ? '▼' : '▶'}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{pl.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{pl.type}</span>
                    <span className="text-gray-400 text-xs">{pl.item_count} producto{Number(pl.item_count) !== 1 ? 's' : ''}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeletePriceList(pl.id) }} className="text-red-500 dark:text-red-400 text-xs hover:underline">Eliminar</button>
                </div>
                {expandedListId === pl.id && (
                  <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={plAddProduct.product_id} onChange={e => {
                        const pid = e.target.value
                        const prod = products.find(p => p.id === pid)
                        setPlAddProduct({
                          ...plAddProduct,
                          product_id: pid,
                          price: prod?.pricing?.final_price || '',
                        })
                      }} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-100">
                        <option value="">Agregar producto...</option>
                        {products.filter(p => !expandedListItems.some((it: any) => it.product_id === p.id)).map(p => (
                          <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
                        ))}
                      </select>
                      <input type="number" step="0.01" placeholder="Precio" value={plAddProduct.price} onChange={e => setPlAddProduct({ ...plAddProduct, price: e.target.value })} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-28 bg-white dark:bg-gray-700 dark:text-gray-100" />
                      <input type="number" step="0.01" placeholder="Dto %" value={plAddProduct.discount_percent} onChange={e => setPlAddProduct({ ...plAddProduct, discount_percent: e.target.value })} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-20 bg-white dark:bg-gray-700 dark:text-gray-100" />
                      <Button variant="primary" onClick={handleAddProductToList} disabled={!plAddProduct.product_id || !plAddProduct.price}>+</Button>
                    </div>
                    {expandedListItems.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 dark:text-gray-400 text-xs border-b border-gray-200 dark:border-gray-700">
                            <th className="pb-1 font-medium">SKU</th>
                            <th className="pb-1 font-medium">Producto</th>
                            <th className="pb-1 font-medium text-right">Precio Lista</th>
                            <th className="pb-1 font-medium text-right">Dto %</th>
                            <th className="pb-1 font-medium text-right">Precio Base</th>
                            <th className="pb-1 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {expandedListItems.map((item: any) => (
                            <tr key={item.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-1 font-mono text-xs text-gray-500 dark:text-gray-400">{item.product_sku}</td>
                              <td className="py-1 text-gray-800 dark:text-gray-200">{item.product_name}</td>
                              <td className="py-1 text-right font-semibold text-green-700 dark:text-green-400">{formatCurrency(parseFloat(item.price))}</td>
                              <td className="py-1 text-right text-gray-600 dark:text-gray-400">{parseFloat(item.discount_percent || '0')}%</td>
                              <td className="py-1 text-right text-gray-400">{item.current_price ? formatCurrency(parseFloat(item.current_price)) : '-'}</td>
                              <td className="py-1">
                                <button onClick={() => handleRemoveProductFromList(item.product_id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs">x</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-2">Sin productos en esta lista.</p>
                    )}
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
