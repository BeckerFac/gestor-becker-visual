# Plan 1: Scroll al form de edicion en Productos

## Contexto
Al tocar "Editar" en un producto, el form se renderiza arriba pero el usuario no lo detecta. Debe hacer scroll automatico al form.

## Estado actual
- `handleEdit()` en Products.tsx (~line 186-199): setea state y `showForm = true`
- No hay scroll ni ref al form

## Cambios

### Frontend (`frontend/src/pages/Products.tsx`):
- Agregar `const formRef = useRef<HTMLDivElement>(null)` al componente
- Wrap el Card del ProductForm con `<div ref={formRef}>`
- En `handleEdit()`, despues de `setShowForm(true)`:
  ```ts
  setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  ```

1 archivo, 3 lineas de cambio.

## Verificacion
- Click "Editar" en un producto de la tabla -> la pagina scrollea al form automaticamente
