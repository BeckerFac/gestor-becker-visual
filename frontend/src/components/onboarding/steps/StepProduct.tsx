import React, { useCallback } from 'react'

interface ProductData {
  name: string
  sku: string
  cost: string
  price: string
  vat_rate: string
}

interface StepProductProps {
  products: ProductData[]
  onChange: (products: ProductData[]) => void
}

const VAT_OPTIONS = [
  { value: '21', label: '21%' },
  { value: '10.5', label: '10.5%' },
  { value: '27', label: '27%' },
  { value: '0', label: 'Exento' },
]

const createEmptyProduct = (): ProductData => ({
  name: '',
  sku: '',
  cost: '',
  price: '',
  vat_rate: '21',
})

export const StepProduct: React.FC<StepProductProps> = ({ products, onChange }) => {
  const addProduct = useCallback(() => {
    if (products.length < 3) {
      onChange([...products, createEmptyProduct()])
    }
  }, [products, onChange])

  const removeProduct = useCallback((index: number) => {
    onChange(products.filter((_, i) => i !== index))
  }, [products, onChange])

  const updateProduct = useCallback((index: number, field: keyof ProductData, value: string) => {
    const updated = products.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    )
    onChange(updated)
  }, [products, onChange])

  // Auto-add first product if empty
  React.useEffect(() => {
    if (products.length === 0) {
      onChange([createEmptyProduct()])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Agrega tu primer producto o servicio
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Asi vas a poder crear tu primera factura al terminar
        </p>
      </div>

      <div className="space-y-4">
        {products.map((product, index) => (
          <div
            key={index}
            className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Producto {index + 1}
              </span>
              {products.length > 1 && (
                <button
                  onClick={() => removeProduct(index)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Eliminar
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Nombre *</label>
                <input
                  type="text"
                  value={product.name}
                  onChange={(e) => updateProduct(index, 'name', e.target.value)}
                  placeholder="Ej: Servicio de consultoria"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">SKU (opcional)</label>
                <input
                  type="text"
                  value={product.sku}
                  onChange={(e) => updateProduct(index, 'sku', e.target.value)}
                  placeholder="Se genera automaticamente"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">IVA</label>
                <select
                  value={product.vat_rate}
                  onChange={(e) => updateProduct(index, 'vat_rate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {VAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Costo</label>
                <input
                  type="number"
                  value={product.cost}
                  onChange={(e) => updateProduct(index, 'cost', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Precio de venta</label>
                <input
                  type="number"
                  value={product.price}
                  onChange={(e) => updateProduct(index, 'price', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {products.length < 3 && (
        <button
          onClick={addProduct}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Agregar otro producto
        </button>
      )}
    </div>
  )
}
