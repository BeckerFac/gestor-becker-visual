---
paths:
  - "frontend/src/components/**"
  - "frontend/src/pages/**"
  - "frontend/src/*.tsx"
---

# GESTIA Frontend Rules

## Performance
- No unnecessary re-renders (useMemo, useCallback for expensive ops)
- Lazy load pages and heavy components
- No blocking calls in render path
- Check bundle size impact of new dependencies

## State Management
- Use Zustand stores for global state
- No prop drilling past 2 levels -- use store or context
- Always use subscribeWithSelector for granular re-renders

## Dark Mode
- Dark mode FIRST -- all components must work in dark mode
- Use Tailwind dark: variants
- Never hardcode colors -- use CSS variables or Tailwind classes

## Code Quality
- Components under 200 lines (Orders.tsx and Invoices.tsx need refactor)
- Extract hooks for complex logic
- TypeScript strict mode, no 'any', no 'as any'
- Descriptive variable names
- Error boundaries around async operations

## API Integration
- Always unwrap response envelopes in api.ts
- Handle loading, error, and empty states
- Show toast notifications for mutations (success + error)
