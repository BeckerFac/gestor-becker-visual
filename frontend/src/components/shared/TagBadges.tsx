import React from 'react'

interface Tag {
  id: string
  name: string
  color: string
}

interface TagBadgesProps {
  tags: Tag[]
  size?: 'sm' | 'md'
  className?: string
}

export const TagBadges: React.FC<TagBadgesProps> = ({ tags, size = 'sm', className = '' }) => {
  if (!tags || tags.length === 0) return null

  const parsed = typeof tags === 'string' ? JSON.parse(tags) : tags
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {parsed.map(tag => (
        <span
          key={tag.id}
          className={`inline-flex items-center rounded-full font-medium ${
            size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
          }`}
          style={{
            backgroundColor: `${tag.color}20`,
            color: tag.color,
            border: `1px solid ${tag.color}40`,
          }}
        >
          {tag.name}
        </span>
      ))}
    </div>
  )
}
