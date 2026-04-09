# Plan 11 — Fase 9: PDF Formato Real + Testing E2E

## Objetivo
Reescribir el PDF de remito para que coincida con el formato real de BeckerVisual, y testear los 6 flujos end-to-end.

## Pre-requisitos
- Todas las fases anteriores (1-8)

## Parte A: PDF del Remito

### Archivo a modificar
- `backend/src/modules/remitos/remitos.service.ts` → `buildRemitoHtml()` (lineas 349-520)

### Formato objetivo (del remito real de BeckerVisual)

```
┌────────────────────────────────────────────────────────────┐
│ [LOGO]                                                      │
│ GRUPO BECKER S.R.L.              R    REMITO               │
│ Portabanners - Impresiones      DOC.  N° 0001-00000382    │
│ Av. Mitre 27 (B1603) V.Martelli NO    FECHA: 24/03/2026   │
│ Tel: (54-11) 4730-1777          VALIDO                     │
│ info@beckervisual.com.ar        COMO   CUIT: 30-71285450-9│
│ www.beckervisual.com.ar         FACT.  ING.BR: CM 30712..  │
│ IVA RESPONSABLE INSCRIPTO       COD91  Inicio: 01/01/2013 │
├────────────────────────────────────────────────────────────┤
│ SEÑOR(ES):                    │ DOMICILIO:                 │
│ ADOX S.A.                     │ Helguera 1363              │
│                               │ Capital Federal (1416)      │
│ IVA: Responsable Inscripto    │ CUIT N°: 30680235135       │
├────────────────────────────────────────────────────────────┤
│ COND. DE PAGO │ N° CLIENTE │ FACTURA N° │ O. PEDIDO N°    │
│               │            │ 0001-01833 │ 0001-39116      │
├────────────────────────────────────────────────────────────┤
│ CANTIDAD │           DESCRIPCION                           │
│    1     │ 1x banner LFB 90x190 Bolsillos AA Adox         │
│          │                                                  │
├────────────────────────────────────────────────────────────┤
│ RECIBI CONFORME:                                           │
│                                                             │
│ ACLARACION: ___________     FIRMA: _______________         │
├────────────────────────────────────────────────────────────┤
│ Imprenta datos │ ORIGINAL BLANCO │ CAI: 45389... │ VTO    │
│                │ DUPLICADO COLOR │ N° 0001-00001 │        │
└────────────────────────────────────────────────────────────┘
```

### Datos del emisor (company)
```typescript
const company = await pool.query(`
  SELECT name, razon_social, cuit, condicion_iva, address, city, province,
    phone, email, website, ingresos_brutos, inicio_actividad,
    rubro_descripcion, punto_venta, logo_url,
    cai_remito, cai_remito_vto, punto_venta_remito
  FROM companies WHERE id = $1
`, [companyId]);
```

Campos que pueden no existir aun: website, ingresos_brutos, inicio_actividad, rubro_descripcion, cai_remito, cai_remito_vto, punto_venta_remito. Si son null, no se muestran.

### Datos del receptor (enterprise)
```typescript
// Ya vienen del remito: enterprise_id → enterprise.name, cuit, address, etc.
```

### HTML Template
Reescribir `buildRemitoHtml()` completo con:
- CSS que replica el formato de papel (border, font-family monospace/serif)
- Seccion emisor con logo
- Letra "R" grande con "DOCUMENTO NO VALIDO COMO FACTURA COD. N° 91"
- Numero formato PPPP-NNNNNNNN
- Datos receptor en cuadro
- Referencias cruzadas (factura, pedido)
- Tabla de items (cantidad + descripcion)
- Area de firma
- Pie con datos de imprenta, CAI, original/duplicado

### Generar 2 copias:
- Original (blanco) — primera pagina
- Duplicado (color/gris) — segunda pagina
El PDF tiene 2 paginas.

## Parte B: Configuracion de empresa

### Archivo a modificar
- `frontend/src/pages/Settings.tsx` o equivalente

Agregar seccion "Configuracion de Remitos":
- Punto de venta para remitos (default: heredar de punto_venta general)
- CAI del remito
- Vencimiento CAI
- Rubro / descripcion de la empresa
- Website
- Ingresos Brutos
- Fecha inicio actividad

Estos campos se guardan en `companies` via la API existente de updateCompany.

## Parte C: Testing E2E — Los 6 Flujos

### Test 1: Pedido → Remito
```
1. Crear pedido #0010 con 10x Pintura + 5x Cemento para Garcia
2. Click derecho → Crear remito
3. Seleccionar: 5x Pintura, 3x Cemento
4. Guardar remito
5. VERIFICAR: order_items.qty_delivered = 5 (Pintura), 3 (Cemento)
6. VERIFICAR: remito_orders tiene entrada para pedido #0010
7. VERIFICAR: remito_items tienen order_item_id correcto
8. Click derecho pedido → remito aparece en lista
```

### Test 2: Pedido → Factura (con bloqueo de remitados)
```
1. Ir a facturas → Importar items del pedido #0010
2. VERIFICAR: Pintura muestra "5 disponible" (10 total - 5 remitadas)
3. VERIFICAR: 5x Pintura aparece BLOQUEADA "Remitado en Remito #X"
4. Crear factura con 5x Pintura (las no remitadas) + 2x Cemento
5. VERIFICAR: factura creada con order_item_id correcto
6. VERIFICAR: qty_remaining actualizado
```

### Test 3: Remito → Factura
```
1. Click derecho en Remito del test 1
2. "Crear factura de pendientes"
3. VERIFICAR: items pre-cargados (5x Pintura, 3x Cemento del remito)
4. Seleccionar solo 3x Pintura
5. Crear factura
6. VERIFICAR: invoice_items tienen remito_item_id
7. VERIFICAR: invoice_remitos tiene entrada
8. Volver al remito → expandible muestra 3/5 Pintura facturado
```

### Test 4: Factura → Remito
```
1. Crear factura directo de pedido #0010: 2x Cemento no remitados
2. Click derecho en factura → "Crear remito"
3. VERIFICAR: items pre-cargados con qty disponible
4. Crear remito de 2x Cemento
5. VERIFICAR: remito_items tienen invoice_item_id
6. VERIFICAR: qty_delivered actualizado
```

### Test 5: Remito multi-pedido
```
1. Crear pedido #0011 para Garcia: 3x Tornillos
2. Ir a Remitos → Nuevo → Seleccionar Garcia
3. Importar items de Pedido #0010 (pendientes: 2x Pintura, 0x Cemento)
4. Importar items de Pedido #0011 (3x Tornillos)
5. Guardar remito
6. VERIFICAR: remito_orders tiene 2 entradas (#0010 y #0011)
7. VERIFICAR: items de ambos pedidos vinculados correctamente
```

### Test 6: Cancelar remito revierte qty
```
1. Verificar qty_delivered de items antes
2. Eliminar/cancelar remito del test 1
3. VERIFICAR: qty_delivered revertido (5→0 Pintura, 3→0 Cemento)
4. VERIFICAR: remito_orders eliminado
5. Ir a facturar pedido → items disponibles vuelven a aparecer
```

### Test 7: PDF correcto
```
1. Descargar PDF del remito creado
2. VERIFICAR: formato coincide con imagen de referencia
3. VERIFICAR: datos emisor completos
4. VERIFICAR: datos receptor correctos
5. VERIFICAR: referencias cruzadas presentes
6. VERIFICAR: 2 paginas (original + duplicado)
```

## Verificacion final
- [ ] Los 6 flujos funcionan sin errores
- [ ] qty_delivered siempre consistente
- [ ] Bloqueo de remitados funciona en importador de pedidos
- [ ] PDF formato real
- [ ] Context menu de pedidos muestra remitos
- [ ] Context menu de remitos muestra facturas
- [ ] Context menu de facturas muestra remitos
- [ ] Expandibles muestran status correcto por item
- [ ] Cancelar remito revierte todo limpiamente
