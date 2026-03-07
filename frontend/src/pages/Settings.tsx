import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

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
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCompany() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (e: any) {
      setTestResult({ success: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuracion</h1>
        <Card><CardContent><SkeletonTable rows={5} cols={2} /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Configuracion</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}<button onClick={() => setSuccess(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

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
            <Button type="submit" variant="primary" loading={saving}>Guardar Cambios</Button>
          </form>
        </CardContent>
      </Card>

      {/* AFIP Configuration */}
      <Card>
        <CardHeader><h3 className="text-lg font-semibold">Configuracion AFIP</h3></CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Environment */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Entorno AFIP</label>
              <select
                className="px-3 py-2 border border-gray-300 rounded-lg w-64"
                value={form.afip_env}
                onChange={e => setForm({ ...form, afip_env: e.target.value })}
              >
                <option value="homologacion">Homologacion (Testing)</option>
                <option value="produccion">Produccion</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                {form.afip_env === 'homologacion'
                  ? 'Modo de prueba: las facturas se autorizan con un CAE de prueba'
                  : 'Modo produccion: las facturas se autorizan con AFIP real'}
              </p>
            </div>

            {/* Certificate Status */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-3">Certificados Digitales</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${hasCert ? 'bg-green-500' : 'bg-red-400'}`} />
                  <span className="text-sm text-gray-700">
                    Certificado (.pem/.crt): <strong>{hasCert ? 'Cargado' : 'No cargado'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${hasKey ? 'bg-green-500' : 'bg-red-400'}`} />
                  <span className="text-sm text-gray-700">
                    Clave privada (.key): <strong>{hasKey ? 'Cargada' : 'No cargada'}</strong>
                  </span>
                </div>
              </div>

              {/* Upload Section */}
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <p className="text-sm text-gray-600">
                  Subi tu certificado digital y clave privada generados desde el portal de AFIP (ARCA).
                </p>

                {certError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                    {certError}
                  </div>
                )}
                {certSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
                    {certSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      Certificado (.pem / .crt)
                    </label>
                    <input
                      ref={certInputRef}
                      type="file"
                      accept=".pem,.crt,.cer"
                      onChange={e => setCertFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {certFile && <p className="text-xs text-green-600 mt-1">Seleccionado: {certFile.name}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      Clave Privada (.key)
                    </label>
                    <input
                      ref={keyInputRef}
                      type="file"
                      accept=".key,.pem"
                      onChange={e => setKeyFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {keyFile && <p className="text-xs text-green-600 mt-1">Seleccionado: {keyFile.name}</p>}
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    onClick={handleUploadCertificates}
                    loading={uploadingCerts}
                    disabled={!certFile || !keyFile}
                  >
                    Subir Certificados
                  </Button>
                  {(hasCert || hasKey) && (
                    <Button variant="secondary" onClick={handleRemoveCertificates}>
                      Eliminar Certificados
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Test Connection */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-800 mb-2">Probar Conexion con AFIP</h4>
              <p className="text-sm text-blue-700 mb-3">
                Verifica que los certificados y la configuracion sean correctos conectandote al servidor de AFIP.
              </p>

              <Button variant="primary" onClick={handleTestConnection} loading={testing}>
                Probar Conexion
              </Button>

              {testResult && (
                <div className={`mt-3 px-3 py-2 rounded text-sm ${testResult.success ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                  {testResult.success ? 'Conexion exitosa con AFIP' : testResult.message}
                </div>
              )}
            </div>

            {/* Help */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-800 mb-2">Como obtener los certificados</h4>
              <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
                <li>Genera una clave privada: <code className="bg-yellow-100 px-1 rounded">openssl genrsa -out clave.key 2048</code></li>
                <li>Genera el CSR: <code className="bg-yellow-100 px-1 rounded">openssl req -new -key clave.key -subj "/C=AR/O=TuEmpresa/CN=BeckerVisual/serialNumber=CUIT {'{'}tu_cuit{'}'}" -out solicitud.csr</code></li>
                <li>En AFIP/ARCA: busca "Administracion de Certificados Digitales"</li>
                <li>Crea un "Computador Fiscal" y subi el archivo .csr</li>
                <li>Descarga el certificado firmado (.crt/.pem)</li>
                <li>En "Administrador de Relaciones": adherir "WSFE - Facturacion Electronica"</li>
                <li>Subi ambos archivos (certificado + clave) aca arriba</li>
              </ol>
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
