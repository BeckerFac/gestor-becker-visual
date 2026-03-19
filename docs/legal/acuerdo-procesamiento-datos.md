# Acuerdo de Procesamiento de Datos (DPA)

**BeckerVisual Gestor - Data Processing Agreement**

**Ultima actualizacion:** 19 de marzo de 2026

---

## 1. Partes

Este Acuerdo de Procesamiento de Datos ("DPA") se celebra entre:

- **El Cliente** (en adelante, "Responsable del Tratamiento" o "el Cliente"): La persona fisica o juridica que contrata los servicios de BeckerVisual Gestor.
- **BeckerVisual** (en adelante, "Encargado del Tratamiento" o "BeckerVisual"): El proveedor de la plataforma de gestion empresarial SaaS.

Este DPA complementa y forma parte integral de los Terminos y Condiciones de Uso del Servicio.

---

## 2. Objeto

El presente acuerdo tiene por objeto regular las condiciones en las que BeckerVisual, en su calidad de Encargado del Tratamiento, trata datos personales por cuenta del Cliente, en el marco de la prestacion del servicio de gestion empresarial.

---

## 3. Datos Procesados

### 3.1. Categorias de datos

| Categoria | Ejemplos | Finalidad |
|-----------|----------|-----------|
| Datos de identificacion | Nombre, email, CUIT, domicilio | Gestion de clientes y proveedores |
| Datos fiscales | Condicion IVA, facturas, comprobantes | Facturacion electronica (AFIP) |
| Datos financieros | Cobros, pagos, cheques, cuenta corriente | Gestion financiera |
| Datos comerciales | Pedidos, cotizaciones, productos, inventario | Operaciones comerciales |
| Datos de contacto | Telefono, email, direccion | Comunicacion comercial |

### 3.2. Titulares de los datos

- Empleados y representantes de la empresa del Cliente
- Clientes y proveedores del Cliente
- Cualquier persona cuyos datos sean ingresados por el Cliente en la Plataforma

### 3.3. Duracion del tratamiento

El tratamiento se realizara durante la vigencia de la relacion contractual y por un periodo de 30 dias corridos tras la finalizacion del contrato (periodo de gracia).

---

## 4. Obligaciones de BeckerVisual (Encargado del Tratamiento)

BeckerVisual se compromete a:

1. **Tratar los datos unicamente conforme a las instrucciones del Cliente** y para la finalidad de proveer el Servicio contratado.
2. **No utilizar los datos para fines propios**, incluyendo marketing, perfilado o cualquier uso no autorizado.
3. **No revelar ni compartir los datos** con terceros, salvo los sub-procesadores autorizados o por obligacion legal.
4. **Implementar medidas de seguridad** tecnicas y organizativas adecuadas para proteger los datos.
5. **Notificar al Cliente** de cualquier brecha de seguridad dentro de las 72 horas de su deteccion.
6. **Asistir al Cliente** en el cumplimiento de sus obligaciones bajo la Ley 25.326.
7. **Eliminar los datos** al finalizar la relacion contractual, transcurrido el periodo de gracia.
8. **Permitir auditorias** razonables por parte del Cliente para verificar el cumplimiento de este DPA.

---

## 5. Medidas de Seguridad

BeckerVisual implementa las siguientes medidas de seguridad:

### 5.1. Medidas tecnicas

- Encriptacion de datos en transito (HTTPS/TLS)
- Hash seguro de contrasenas (bcrypt)
- Autenticacion basada en tokens JWT con expiracion
- Control de acceso basado en roles (RBAC)
- Rate limiting y proteccion contra ataques de fuerza bruta
- Certificados AFIP almacenados de forma segura
- Backups automaticos y regulares de la base de datos
- Aislamiento de datos por empresa (multi-tenant con company_id)

### 5.2. Medidas organizativas

- Acceso restringido a los sistemas de produccion
- Politicas de seguridad para el equipo de desarrollo
- Revision periodica de accesos y permisos
- Procedimiento documentado de respuesta a incidentes

---

## 6. Sub-procesadores

BeckerVisual utiliza los siguientes sub-procesadores para la prestacion del Servicio:

| Sub-procesador | Ubicacion | Funcion | Datos procesados |
|----------------|-----------|---------|-----------------|
| Render | Estados Unidos | Hosting de infraestructura (servidores y base de datos) | Todos los datos del servicio |
| AFIP/ARCA | Argentina | Facturacion electronica | Datos fiscales de la empresa, comprobantes |

### 6.1. Cambios en sub-procesadores

BeckerVisual notificara al Cliente con al menos 30 dias de anticipacion sobre la incorporacion de nuevos sub-procesadores. El Cliente puede oponerse a la incorporacion de un nuevo sub-procesador, en cuyo caso las partes buscaran una solucion alternativa.

---

## 7. Notificacion de Brechas de Seguridad

En caso de una brecha de seguridad que afecte datos personales procesados bajo este acuerdo, BeckerVisual se compromete a:

1. **Notificar al Cliente dentro de las 72 horas** de detectada la brecha, proporcionando:
   - Descripcion de la naturaleza de la brecha
   - Categorias y numero aproximado de titulares afectados
   - Datos de contacto del responsable de seguridad
   - Descripcion de las posibles consecuencias
   - Medidas adoptadas o propuestas para remediar la brecha

2. **Cooperar con el Cliente** en la investigacion y remediacion del incidente.

3. **Documentar la brecha** incluyendo los hechos, sus efectos y las medidas correctivas adoptadas.

4. **Asistir al Cliente** en la notificacion a la AAIP y a los titulares afectados, cuando sea necesario.

---

## 8. Transferencia Internacional de Datos

Los datos se almacenan en servidores de Render ubicados en Estados Unidos. Esta transferencia internacional se realiza con las siguientes garantias:

- Render cumple con estandares de seguridad de la industria
- La transferencia es necesaria para la ejecucion del contrato de prestacion del servicio
- Se aplican las medidas de seguridad descritas en la Seccion 5
- Se cumple con las disposiciones de la Ley 25.326 y la Disposicion 60-E/2016

---

## 9. Eliminacion de Datos al Finalizar el Contrato

Al finalizar la relacion contractual:

1. **Periodo de gracia (30 dias):** El Cliente puede exportar todos sus datos a traves de las herramientas provistas por la Plataforma.
2. **Eliminacion:** Transcurrido el periodo de gracia, BeckerVisual procedera a la eliminacion definitiva de los datos del Cliente de todos los sistemas, incluyendo backups.
3. **Certificacion:** A solicitud del Cliente, BeckerVisual proporcionara una certificacion de la eliminacion de datos.
4. **Excepciones:** Los datos requeridos por obligacion legal (ej: comprobantes fiscales) podran ser retenidos por el plazo legal correspondiente.

---

## 10. Derechos de los Titulares

BeckerVisual asistira al Cliente en el cumplimiento de sus obligaciones respecto a los derechos de los titulares de datos conforme a la Ley 25.326:

- Derecho de acceso
- Derecho de rectificacion
- Derecho de supresion
- Derecho a la informacion

---

## 11. Legislacion Aplicable

Este DPA se rige por las leyes de la Republica Argentina, en particular:

- Ley 25.326 de Proteccion de Datos Personales
- Decreto 1558/2001 (Reglamentacion)
- Disposiciones de la AAIP

Para la resolucion de controversias, las partes se someten a la jurisdiccion de los Tribunales Ordinarios de la Ciudad Autonoma de Buenos Aires.

---

## 12. Vigencia

Este DPA entra en vigencia al momento de la aceptacion de los Terminos y Condiciones del Servicio y permanece vigente durante toda la relacion contractual, extendiendose hasta la completa eliminacion de los datos del Cliente.

---

## Firmas

Para clientes empresariales que requieran una copia firmada de este DPA, contactar a: legal@beckervisual.com

---

*Este documento es un template. Para su validez contractual, debe ser complementado con los datos especificos de cada cliente empresarial y firmado por ambas partes.*
