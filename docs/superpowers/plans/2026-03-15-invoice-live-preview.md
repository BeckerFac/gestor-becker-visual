# Invoice Live Preview - Plan de Implementacion

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar el modal de factura en una experiencia de edicion en vivo donde el usuario ve exactamente como quedara la factura mientras modifica cada campo, con la misma estetica del PDF final.

**Architecture:** Split-panel modal: lado izquierdo con formulario de edicion, lado derecho con preview en tiempo real que replica el layout del PDF. Los cambios se reflejan instantaneamente sin roundtrips al servidor. El preview se renderiza con HTML/CSS puro (sin generar PDF en cada cambio). Solo al autorizar se genera el PDF real via Puppeteer.

**Tech Stack:** React (estado local), CSS Grid, HTML template que replica el PDF de Puppeteer, InvoicePreviewModal refactorizado.

---

## Fundamento Psicologico

### Por que esta feature importa

Crear una factura fiscal en Argentina es un acto **irreversible**. Una vez autorizada por AFIP, no se puede modificar. Esto genera en el usuario:

1. **Ansiedad de consecuencia**: "Si me equivoco, no puedo volver atras"
2. **Incertidumbre visual**: "Esto que veo en el formulario, es lo que va a salir?"
3. **Sobrecarga cognitiva**: "Tengo que acordarme de revisar tipo, punto de venta, items, IVA, totales, CUIT..."

### Principios de diseno

1. **WYSIWYG reduce ansiedad**: Si el usuario VE la factura final mientras edita, no necesita "imaginar" como va a quedar. La brecha entre intencion y resultado desaparece.

2. **Feedback inmediato** (Ley de Doherty): Cada cambio se refleja en < 100ms en el preview. No hay boton "Actualizar preview". El cerebro humano conecta causa-efecto si la respuesta es < 400ms.

3. **Validacion en contexto** (no como paso separado): Los errores aparecen DONDE ocurren (CUIT faltante se marca en rojo en el preview, no en un alert separado). Esto reduce la carga de memoria de trabajo.

4. **Progresion de compromiso**: El boton "Autorizar AFIP" tiene 2 pasos: (1) ver resumen, (2) confirmar. Cada paso reduce la distancia psicologica al acto irreversible, dando tiempo para detectar errores.

5. **Color como comunicacion**: Verde = autorizado/seguro. Amarillo = borrador/editable. Rojo = error/peligro. Sin ambiguedad.

---

## Diseno Tecnico

### Estado actual
- `InvoicePreviewModal.tsx` ya tiene tabs "Datos" y "Vista PDF"
- Tab "Datos" permite editar items (nombre, cantidad, precio, IVA)
- Tab "Vista PDF" muestra un iframe con el PDF generado por Puppeteer
- El PDF se genera en el backend con HTML template via Puppeteer

### Lo que falta
- El preview no se actualiza en tiempo real (el PDF del iframe es estatico)
- No se pueden editar datos del emisor/receptor/fecha en el preview
- La vista "Datos" y "Vista PDF" son mundos separados
- No hay sensacion de "asi va a quedar la factura"

### Solucion: Live Preview Panel

Reemplazar el tab system por un **split-panel**:

```
+---------------------------+----------------------------+
|  FORMULARIO (editable)    |  PREVIEW (solo lectura)    |
|                           |                            |
|  [Tipo factura: A v]      |  +-----------------------+ |
|  [Punto venta: 1   ]      |  | FACTURA A             | |
|  [Fecha: 15/03/2026]      |  | N° 00001-00000002     | |
|                           |  |                       | |
|  Cliente:                 |  | Emisor:  BeckerVisual | |
|  [Maria Martha     ]      |  | CUIT: 27-23091318-3   | |
|  CUIT: [20-12345678-9]    |  |                       | |
|                           |  | Receptor: Maria Martha| |
|  Items:                   |  | CUIT: 20-12345678-9   | |
|  [Banner 2x1] [2] [$500] |  |                       | |
|  [Ploteo     ] [1] [$300] |  | Banner 2x1    $1000   | |
|                           |  | Ploteo          $300  | |
|  IVA: 21%                 |  |                       | |
|                           |  | Neto:         $1300   | |
|                           |  | IVA 21%:       $273   | |
|                           |  | TOTAL:        $1573   | |
|                           |  +-----------------------+ |
|                           |                            |
|  [Eliminar] [Autorizar AFIP]                           |
+---------------------------+----------------------------+
```

- Panel izquierdo: formulario con TODOS los campos editables
- Panel derecho: replica visual del PDF que se actualiza en cada keystroke
- En mobile: stack vertical (form arriba, preview abajo)
- El preview usa el MISMO HTML template que usa Puppeteer, pero renderizado inline

---

## Tasks

### Task 1: Extraer template HTML de factura a modulo compartido

**Files:**
- Read: `backend/src/modules/pdf/pdf.service.ts` (metodo que genera HTML)
- Create: `frontend/src/components/shared/InvoiceTemplate.tsx`

El backend genera el PDF con un HTML template. Extraer ese template a un componente React que acepta props y renderiza el mismo layout.

- [ ] **Step 1: Leer el HTML template del backend**

Leer `pdf.service.ts` completo para encontrar el metodo `buildInvoiceHtml` o similar que genera el HTML de la factura.

- [ ] **Step 2: Crear InvoiceTemplate.tsx**

Componente React que acepta:
```typescript
interface InvoiceTemplateProps {
  // Company
  companyName: string
  companyCuit: string
  companyAddress?: string
  // Customer
  customerName: string
  customerCuit?: string
  customerAddress?: string
  taxCondition?: string
  // Invoice
  invoiceType: string  // A, B, C
  invoiceNumber: string
  puntoVenta: number
  invoiceDate: string
  // Items
  items: { name: string; quantity: number; unitPrice: number; vatRate: number }[]
  // Computed
  subtotal: number
  vatAmount: number
  total: number
  // Optional (post-auth)
  cae?: string
  caeExpiry?: string
  authorized?: boolean
}
```

Renderiza HTML/CSS identico al del PDF pero como componente React con Tailwind. Debe verse como una factura real argentina:
- Header con tipo (A/B/C) en recuadro
- Datos emisor y receptor
- Tabla de items
- Totales
- Zona CAE (vacia si borrador)

- [ ] **Step 3: Commit**

### Task 2: Refactorizar InvoicePreviewModal a split-panel

**Files:**
- Modify: `frontend/src/components/shared/InvoicePreviewModal.tsx`

- [ ] **Step 1: Cambiar layout de tabs a split-panel**

Eliminar el tab system (datos/pdf). Reemplazar con grid de 2 columnas:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-0 max-h-[85vh]">
  {/* Left: Form */}
  <div className="overflow-y-auto p-6 border-r border-gray-200">
    {/* All editable fields */}
  </div>
  {/* Right: Live Preview */}
  <div className="overflow-y-auto bg-gray-100 p-6">
    <div className="transform scale-[0.7] origin-top-left">
      <InvoiceTemplate {...computedProps} />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Mover campos editables al panel izquierdo**

Todos los campos existentes (tipo, punto venta, items) van al panel izquierdo. Agregar campos editables nuevos:
- Nombre del cliente (text input)
- CUIT del cliente (text input con validacion)
- Fecha de factura (date input)
- Notas/observaciones

- [ ] **Step 3: Conectar estado al preview**

El panel derecho recibe los mismos valores que el formulario via props. Cada `onChange` actualiza el estado y el preview se re-renderiza automaticamente (React lo hace por defecto).

- [ ] **Step 4: Agregar indicadores de validacion en el preview**

En el preview, marcar en rojo los campos invalidos:
- CUIT faltante para Factura A: recuadro rojo parpadeante
- Items sin precio: fila en rojo claro
- Total = $0: total en rojo

- [ ] **Step 5: Responsive - mobile stack**

En pantallas < lg, cambiar a stack vertical: form primero, preview despues con un boton "Ver preview" que scrollea al preview.

- [ ] **Step 6: Commit**

### Task 3: Agregar "Descargar preview PDF" sin autorizar

**Files:**
- Modify: `frontend/src/components/shared/InvoicePreviewModal.tsx`

- [ ] **Step 1: Agregar boton "Descargar Borrador PDF"**

Visible solo cuando la factura es borrador. Llama al endpoint de PDF existente para generar un PDF del borrador actual (sin CAE, con marca de agua "BORRADOR").

- [ ] **Step 2: Commit**

### Task 4: Actualizar datos en backend al guardar cambios

**Files:**
- Modify: `backend/src/modules/invoices/invoices.service.ts`

- [ ] **Step 1: Crear o verificar endpoint updateDraftInvoice**

Debe aceptar cambios en: invoice_type, invoice_date, customer info, items. Solo para facturas en estado draft.

- [ ] **Step 2: Agregar boton "Guardar cambios" en el modal**

Cuando el usuario edita campos y quiere cerrar sin autorizar, guardar los cambios en el borrador.

- [ ] **Step 3: Commit**

### Task 5: Build y validacion

- [ ] **Step 1: `./scripts/validate.sh`**
- [ ] **Step 2: Push**
- [ ] **Step 3: Verificar en produccion**
