import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime } from '@/lib/utils'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { BillingSection } from '@/components/billing/BillingSection'
import { SecretarIASection } from '@/components/secretaria/SecretarIASection'

export const Settings: React.FC = () => {
  const authCompany = useAuthStore((state) => state.company)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showRemoveCertsConfirm, setShowRemoveCertsConfirm] = useState(false)
  const [removingCerts, setRemovingCerts] = useState(false)
  const [form, setForm] = useState({
    name: '', cuit: '', address: '', city: '', province: '',
    phone: '', email: '', afip_env: 'homologacion',
  })
  const [hasCert, setHasCert] = useState(false)
  const [hasKey, setHasKey] = useState(false)

  // Certificate upload state
  const [certFile, setCertFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [uploadingCerts, setUploadingCerts] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)
  const [certSuccess, setCertSuccess] = useState<string | null>(null)
  const certInputRef = useRef<HTMLInputElement>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)

  // AFIP test connection state
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // AFIP wizard state
  const [wizardStep, setWizardStep] = useState(1)
  const [osTabs, setOsTabs] = useState<'linux' | 'windows' | 'macos'>('linux')
  const [puntosVenta, setPuntosVenta] = useState<number[]>([])
  const [newPuntoVenta, setNewPuntoVenta] = useState('')
  const [afipLastTest, setAfipLastTest] = useState<string | null>(null)
  const [afipLastTestOk, setAfipLastTestOk] = useState<boolean>(false)

  const loadCompany = async () => {
    try {
      setLoading(true)
      const company: any = await api.getMyCompany()
      setForm({
        name: company.name || '', cuit: company.cuit || '',
        address: company.address || '', city: company.city || '',
        province: company.province || '', phone: company.phone || '',
        email: company.email || '', afip_env: company.afip_env || 'homologacion',
      })
      setHasCert(!!company.has_afip_cert)
      setHasKey(!!company.has_afip_key)
      setPuntosVenta(company.puntos_venta || [])
      setAfipLastTest(company.afip_last_test || null)
      setAfipLastTestOk(!!company.afip_last_test_ok)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCompany() }, [])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await api.updateMyCompany(form)
      toast.success('Datos de la empresa actualizados correctamente')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleUploadCertificates = async () => {
    if (!certFile || !keyFile) {
      setCertError('Seleccioná ambos archivos: certificado (.pem/.crt) y clave privada (.key)')
      return
    }
    setUploadingCerts(true)
    setCertError(null)
    setCertSuccess(null)
    try {
      const certContent = await certFile.text()
      const keyContent = await keyFile.text()
      await api.uploadAfipCertificates(certContent, keyContent)
      toast.success('Certificados AFIP guardados correctamente')
      setCertSuccess('Certificados AFIP guardados correctamente')
      setHasCert(true)
      setHasKey(true)
      setCertFile(null)
      setKeyFile(null)
      if (certInputRef.current) certInputRef.current.value = ''
      if (keyInputRef.current) keyInputRef.current.value = ''
    } catch (e: any) {
      setCertError(e.message)
    } finally {
      setUploadingCerts(false)
    }
  }

  const handleRemoveCertificates = () => {
    setShowRemoveCertsConfirm(true)
  }

  const confirmRemoveCertificates = async () => {
    setRemovingCerts(true)
    try {
      await api.removeAfipCertificates()
      setHasCert(false)
      setHasKey(false)
      toast.success('Certificados eliminados correctamente')
      setCertSuccess('Certificados eliminados')
    } catch (e: any) {
      toast.error(e.message)
      setCertError(e.message)
    } finally {
      setRemovingCerts(false)
      setShowRemoveCertsConfirm(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testAfipConnection()
      setTestResult(result)
      setAfipLastTest(new Date().toISOString())
      setAfipLastTestOk(result.success)
    } catch (e: any) {
      setTestResult({ success: false, message: e.message })
      setAfipLastTest(new Date().toISOString())
      setAfipLastTestOk(false)
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuracion</h1>
        <Card><CardContent><SkeletonTable rows={5} cols={2} /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuracion</h1>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}<button onClick={() => setSuccess(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Billing & Subscription */}
      <BillingSection />

      {/* SecretarIA - WhatsApp Assistant */}
      <SecretarIASection />

      {/* Company Data */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Datos de la Empresa</h3></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Razon Social *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              <Input label="CUIT *" value={form.cuit} onChange={e => setForm({ ...form, cuit: e.target.value })} placeholder="27-23091318-3" required />
              <Input label="Direccion" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <Input label="Ciudad" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              <Input label="Provincia" value={form.province} onChange={e => setForm({ ...form, province: e.target.value })} />
              <Input label="Telefono" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <PermissionGate module="settings" action="edit">
              <Button type="submit" variant="primary" loading={saving}>Guardar Cambios</Button>
            </PermissionGate>
          </form>
        </CardContent>
      </Card>

      {/* AFIP Configuration - Wizard */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Configuracion AFIP / ARCA</h3></CardHeader>
        <CardContent>
          {/* Stepper */}
          <div className="flex items-center justify-between mb-8">
            {[
              { n: 1, label: 'Datos Empresa' },
              { n: 2, label: 'Generar CSR' },
              { n: 3, label: 'Subir a ARCA' },
              { n: 4, label: 'Certificados' },
              { n: 5, label: 'Configurar' },
            ].map((step, i) => (
              <React.Fragment key={step.n}>
                <button
                  onClick={() => setWizardStep(step.n)}
                  className={`flex flex-col items-center gap-1 ${wizardStep === step.n ? 'text-blue-600' : wizardStep > step.n ? 'text-green-600' : 'text-gray-400'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                    wizardStep === step.n ? 'border-blue-600 bg-blue-50' :
                    wizardStep > step.n ? 'border-green-500 bg-green-50' :
                    'border-gray-300 bg-white'
                  }`}>
                    {wizardStep > step.n ? '\u2713' : step.n}
                  </div>
                  <span className="text-xs font-medium">{step.label}</span>
                </button>
                {i < 4 && <div className={`flex-1 h-0.5 mx-2 ${wizardStep > step.n ? 'bg-green-400' : 'bg-gray-200'}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* Step content */}
          <div className="space-y-6">

            {/* Step 1 - Datos Empresa */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Verifica que los datos de tu empresa esten completos. El CUIT es obligatorio para facturacion electronica.</p>
                <div className={`flex items-center gap-3 p-3 rounded-lg border ${form.cuit ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <span className={`w-3 h-3 rounded-full ${form.cuit ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm">{form.cuit ? `CUIT: ${form.cuit}` : 'CUIT no configurado — completalo en "Datos de la Empresa" arriba'}</span>
                </div>
                <div className={`flex items-center gap-3 p-3 rounded-lg border ${form.name ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <span className={`w-3 h-3 rounded-full ${form.name ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-sm">{form.name ? `Razon Social: ${form.name}` : 'Razon Social no configurada'}</span>
                </div>
                <Button variant="primary" onClick={() => setWizardStep(2)} disabled={!form.cuit}>Siguiente</Button>
              </div>
            )}

            {/* Step 2 - Generar CSR */}
            {wizardStep === 2 && (() => {
              const csrCommand = `openssl req -new -key clave.key -subj "/C=AR/O=${form.name.replace(/"/g, '')}/CN=BeckerVisual/serialNumber=CUIT ${form.cuit}" -out solicitud.csr`
              return (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Genera la clave privada y el CSR (Certificate Signing Request) en tu computadora.</p>

                  {/* OS Tabs */}
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                    {(['linux', 'windows', 'macos'] as const).map(os => (
                      <button key={os} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${osTabs === os ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`} onClick={() => setOsTabs(os)}>
                        {os === 'linux' ? 'Linux' : os === 'windows' ? 'Windows' : 'macOS'}
                      </button>
                    ))}
                  </div>

                  <div className="bg-gray-900 rounded-lg p-4 space-y-3">
                    {osTabs === 'windows' && (
                      <p className="text-yellow-400 text-xs mb-2">Usar Git Bash, WSL, o descargar OpenSSL portable. Abrir terminal en la carpeta deseada.</p>
                    )}

                    <div className="flex items-center justify-between">
                      <code className="text-green-400 text-sm">openssl genrsa -out clave.key 2048</code>
                      <button onClick={() => navigator.clipboard.writeText('openssl genrsa -out clave.key 2048')} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700">Copiar</button>
                    </div>

                    <div className="flex items-center justify-between">
                      <code className="text-green-400 text-sm break-all">{csrCommand}</code>
                      <button onClick={() => navigator.clipboard.writeText(csrCommand)} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 ml-2 whitespace-nowrap">Copiar</button>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500">Estos comandos generan dos archivos: <code>clave.key</code> (clave privada) y <code>solicitud.csr</code> (pedido de certificado).</p>

                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setWizardStep(1)}>Anterior</Button>
                    <Button variant="primary" onClick={() => setWizardStep(3)}>Siguiente</Button>
                  </div>
                </div>
              )
            })()}

            {/* Step 3 - Subir a ARCA */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Subi el archivo .csr al portal de AFIP/ARCA para obtener tu certificado digital.</p>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Ingresa a <a href="https://auth.afip.gob.ar/contribuyente_/login.xhtml" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">AFIP - Login con CUIT</a></li>
                  <li>Busca el servicio <strong>"Administracion de Certificados Digitales"</strong></li>
                  <li>Crea un nuevo <strong>"Computador Fiscal"</strong> (nombre: BeckerVisual o el que prefieras)</li>
                  <li>Subi el archivo <code className="bg-gray-100 px-1 rounded">solicitud.csr</code></li>
                  <li>Descarga el certificado firmado (.crt o .pem)</li>
                  <li>En <strong>"Administrador de Relaciones de Clave Fiscal"</strong>: adherir el servicio <strong>"WSFE - Facturacion Electronica"</strong> al computador fiscal creado</li>
                </ol>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setWizardStep(2)}>Anterior</Button>
                  <Button variant="primary" onClick={() => setWizardStep(4)}>Siguiente</Button>
                </div>
              </div>
            )}

            {/* Step 4 - Certificados */}
            {wizardStep === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Subi tu certificado digital y clave privada.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${hasCert ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className="text-sm">Certificado: <strong>{hasCert ? 'Cargado' : 'No cargado'}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${hasKey ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className="text-sm">Clave privada: <strong>{hasKey ? 'Cargada' : 'No cargada'}</strong></span>
                  </div>
                </div>

                {certError && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded text-sm">{certError}</div>}
                {certSuccess && <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">{certSuccess}</div>}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Certificado (.pem / .crt)</label>
                    <input ref={certInputRef} type="file" accept=".pem,.crt,.cer" onChange={e => setCertFile(e.target.files?.[0] || null)} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Clave Privada (.key)</label>
                    <input ref={keyInputRef} type="file" accept=".key,.pem" onChange={e => setKeyFile(e.target.files?.[0] || null)} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                  </div>
                </div>

                <div className="flex gap-3">
                  <PermissionGate module="settings" action="edit">
                    <Button variant="primary" onClick={handleUploadCertificates} loading={uploadingCerts} disabled={!certFile || !keyFile}>Subir Certificados</Button>
                  </PermissionGate>
                  {(hasCert || hasKey) && (
                    <PermissionGate module="settings" action="edit">
                      <Button variant="secondary" onClick={handleRemoveCertificates}>Eliminar Certificados</Button>
                    </PermissionGate>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <Button variant="secondary" onClick={() => setWizardStep(3)}>Anterior</Button>
                  <Button variant="primary" onClick={() => setWizardStep(5)} disabled={!hasCert || !hasKey}>Siguiente</Button>
                </div>
              </div>
            )}

            {/* Step 5 - Configurar y Probar */}
            {wizardStep === 5 && (
              <div className="space-y-6">
                {/* Entorno */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Entorno AFIP</label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg w-64 bg-white dark:bg-gray-700 dark:text-gray-100" value={form.afip_env} onChange={e => setForm({ ...form, afip_env: e.target.value })}>
                    <option value="homologacion">Homologacion (Testing)</option>
                    <option value="produccion">Produccion</option>
                  </select>
                </div>

                {/* Puntos de venta */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700">Puntos de Venta</label>
                  <div className="flex flex-wrap gap-2">
                    {puntosVenta.map((pv, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                        PV {pv}
                        <button onClick={() => { const updated = puntosVenta.filter((_, idx) => idx !== i); setPuntosVenta(updated); api.updateMyCompany({ puntos_venta: updated }) }} className="text-blue-600 hover:text-blue-900 font-bold ml-1">x</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input placeholder="Ej: 3" type="number" value={newPuntoVenta} onChange={e => setNewPuntoVenta(e.target.value)} className="w-24" />
                    <Button variant="secondary" onClick={() => {
                      const pv = parseInt(newPuntoVenta)
                      if (pv > 0 && !puntosVenta.includes(pv)) {
                        const updated = [...puntosVenta, pv]
                        setPuntosVenta(updated)
                        setNewPuntoVenta('')
                        api.updateMyCompany({ puntos_venta: updated })
                      }
                    }}>Agregar</Button>
                  </div>
                </div>

                {/* Test conexion */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Probar Conexion con AFIP</h4>
                  <PermissionGate module="settings" action="edit">
                    <Button variant="primary" onClick={handleTestConnection} loading={testing}>Probar Conexion</Button>
                  </PermissionGate>
                  {testResult && (
                    <div className={`mt-3 px-3 py-2 rounded text-sm ${testResult.success ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                      {testResult.success ? 'Conexion exitosa con AFIP' : testResult.message}
                    </div>
                  )}
                  {afipLastTest && (
                    <p className="text-xs text-gray-500 mt-2">
                      Ultimo test: {formatDateTime(afipLastTest)} —
                      <span className={afipLastTestOk ? 'text-green-600' : 'text-red-600'}>{afipLastTestOk ? ' Exitoso' : ' Fallido'}</span>
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setWizardStep(4)}>Anterior</Button>
                  <PermissionGate module="settings" action="edit">
                    <Button variant="primary" onClick={handleSubmit} loading={saving}>Guardar Todo</Button>
                  </PermissionGate>
                </div>
              </div>
            )}

          </div>
        </CardContent>
      </Card>

      {/* Module Configuration */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Modulos y Configuracion</h3></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Configura que modulos se muestran en el sistema. Podes activar o desactivar modulos segun lo que tu empresa necesite.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await api.resetOnboarding()
                    useAuthStore.getState().setOnboardingCompleted(false)
                    window.location.reload()
                  } catch (e: any) {
                    toast.error(e.message || 'Error al reiniciar wizard')
                  }
                }}
              >
                Repetir asistente de configuracion
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Informacion del Sistema</h3></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Version:</span> <span className="font-medium">1.0.0</span></div>
            <div><span className="text-gray-500">Backend:</span> <span className="font-medium">Express + PostgreSQL</span></div>
            <div><span className="text-gray-500">Frontend:</span> <span className="font-medium">React + Tailwind CSS</span></div>
            <div><span className="text-gray-500">AFIP SDK:</span> <span className="font-medium">@afipsdk/afip.js</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Legal */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Legal</h3></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <a
              href="/legal/terminos"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-blue-600 dark:text-blue-400 hover:underline text-sm"
            >
              Terminos y Condiciones
            </a>
            <a
              href="/legal/privacidad"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-blue-600 dark:text-blue-400 hover:underline text-sm"
            >
              Politica de Privacidad
            </a>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showRemoveCertsConfirm}
        title="Eliminar Certificados AFIP"
        message="¿Eliminar los certificados AFIP? Las facturas no se podran autorizar en modo produccion."
        confirmLabel="Eliminar"
        variant="danger"
        loading={removingCerts}
        onConfirm={confirmRemoveCertificates}
        onCancel={() => setShowRemoveCertsConfirm(false)}
      />
    </div>
  )
}
