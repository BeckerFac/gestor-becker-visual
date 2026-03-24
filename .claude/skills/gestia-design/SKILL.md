---
name: gestia-design
description: "Enforces GESTIA exact design standards for all UI: colors, spacing, typography, layout. Dark mode first."
user-invocable: true
---

# GESTIA Design System

When building ANY UI for GESTIA:

## Brand Colors
- Primary: #6366F1 (Indigo 500)
- Primary Light: #818CF8 (Indigo 400)
- Primary Dark: #4F46E5 (Indigo 600)
- Accent: #06B6D4 (Cyan 500)
- Background: #0A0A0F (near black)
- Surface: rgba(255, 255, 255, 0.03)
- Surface hover: rgba(255, 255, 255, 0.06)
- Border: rgba(255, 255, 255, 0.06)
- Text primary: #F8FAFC (Slate 50)
- Text secondary: #94A3B8 (Slate 400)
- Text tertiary: #475569 (Slate 600)
- Success: #22C55E
- Warning: #F59E0B
- Error: #EF4444

## Typography
- Font: Inter (system fallback: -apple-system, sans-serif)
- Headings: -0.025em letter-spacing, font-weight 700
- Body: 14-15px, line-height 1.6
- Code: Mono 14px
- Section headings: 32-56px
- Labels/badges: 11-12px uppercase, 0.05em tracking

## Spacing & Layout
- Section gap: 64px (py-16)
- Card padding: 24px (p-6)
- Inner content gap: 12-16px
- Max content width: 1280px
- Border radius: 16px cards, 12px modals, 8px buttons, 6px inputs

## Dark Mode Aesthetic (DEFAULT)
- NEVER flat black. Use depth through:
  - Subtle gradients (top-gradient-to-b)
  - Glow effects on hover (box-shadow with brand color 0.09 opacity)
  - Border separators (rgba white 0.06-0.10)
  - Surface elevation (slightly lighter bg per level)
- Glass morphism for modals: backdrop-filter blur(16px), bg rgba(255,255,255,0.05)

## Component Patterns
- Buttons: rounded-lg, font-medium, transition-all duration-200
- Cards: rounded-xl, border border-white/5, bg-white/[0.03], hover:bg-white/[0.06]
- Tables: divide-y divide-white/5, hover:bg-white/[0.02] on rows
- Inputs: rounded-lg, bg-white/5, border-white/10, focus:border-indigo-500
- Badges: rounded-full, px-2.5 py-0.5, text-xs font-medium
- Modals: backdrop-blur-sm, rounded-2xl, max-w-lg

## Icons
- Lucide React icons
- Size: 16px inline, 20px standalone, 24px headers
- Stroke width: 1.5-2

## Animations
- Transitions: 200ms ease for interactions, 300ms for layout changes
- Hover: translateY(-2px) + shadow increase for cards
- No decorative animations that don't serve UX
