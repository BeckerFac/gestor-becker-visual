import React from 'react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/**
 * Edge cases handled:
 * - 0 items → component not rendered (returns null)
 * - 1 page only → component not rendered
 * - currentPage out of range → clamped to valid range
 * - Very many pages → ellipsis shown
 * - Last page with fewer items → correct "showing X-Y of Z" display
 */
export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
}) => {
  // Don't render if no data or only 1 page
  if (totalItems === 0 || totalPages <= 1) return null

  // Clamp current page to valid range
  const safePage = Math.max(1, Math.min(currentPage, totalPages))

  const startItem = (safePage - 1) * pageSize + 1
  const endItem = Math.min(safePage * pageSize, totalItems)

  // Generate page numbers with ellipsis for large page counts
  const getPageNumbers = (): (number | '...')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages: (number | '...')[] = [1]
    if (safePage > 3) pages.push('...')
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) {
      pages.push(i)
    }
    if (safePage < totalPages - 2) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">
          {startItem}-{endItem} de {totalItems}
        </span>
        {onPageSizeChange && (
          <select
            className="text-xs border border-gray-300 rounded px-1.5 py-1"
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s}>{s} por página</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
        >
          ‹
        </button>
        {getPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-1.5 text-gray-400 text-sm">...</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`px-2.5 py-1 text-sm rounded border transition-colors ${
                p === safePage
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
        >
          ›
        </button>
      </div>
    </div>
  )
}
