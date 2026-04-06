# Plan 2: Icono calendario en TODOS los campos de fecha

## Contexto
`DateInput` es solo texto DD/MM/AAAA. Se quiere un icono de calendario que abra un datepicker nativo del browser. El tipeo manual sigue funcionando.

## Estado actual
- `DateInput.tsx` (`frontend/src/components/ui/DateInput.tsx`): input `type="text"` con auto-format DD/MM/AAAA
- ~35 instancias de `<DateInput>` en 15 archivos
- ~17 instancias de `<input type="date">` nativo en otros archivos (Retenciones, Contabilidad, etc)

## Cambios

### Frontend (`frontend/src/components/ui/DateInput.tsx`):
- Agregar `<input ref={pickerRef} type="date" className="sr-only" tabIndex={-1}>` oculto
- Agregar boton SVG calendario posicionado absolute a la derecha del input
- Al click del icono: `pickerRef.current?.showPicker()` (API nativa Chrome/Firefox/Safari)
- Al seleccionar fecha en el picker: convertir a DD/MM/AAAA y setear en el input visible
- Sincronizar `value` del date input oculto con el ISO value actual
- Agregar `padding-right` al input texto para no tapar el icono

Estructura:
```tsx
<div className="relative">
  <input type="text" ... className="... pr-9" />
  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 ..."
    onClick={() => pickerRef.current?.showPicker()}>
    <svg>CalendarIcon</svg>
  </button>
  <input ref={pickerRef} type="date" className="sr-only absolute" tabIndex={-1}
    value={isoValue} onChange={e => handlePickerChange(e.target.value)} />
</div>
```

Esto aplica AUTOMATICAMENTE a los ~35 usos existentes sin tocar ninguna otra pagina.

### Archivos adicionales (reemplazar `type="date"` nativo por `<DateInput>`):
- `Retenciones.tsx` (~2 instancias)
- `Contabilidad.tsx` (~2 instancias)
- Otros archivos con `<input type="date">` nativo

## Verificacion
- En cualquier campo de fecha: click icono calendario -> abre picker nativo -> seleccionar dia -> fecha se llena
- Tipeo manual sigue funcionando (DD/MM/AAAA)
- Reabrir calendario con fecha ya seteada -> muestra fecha actual seleccionada
