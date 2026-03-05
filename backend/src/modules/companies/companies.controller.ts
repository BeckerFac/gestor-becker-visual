import { Request, Response, NextFunction } from 'express'
import { companiesService } from './companies.service'
import { AuthRequest } from '../../middlewares/auth'
import { ApiError } from '../../middlewares/errorHandler'

export class CompaniesController {
  async getMyCompany(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id
      const company = await companiesService.getCompanyById(companyId)
      // Don't send full cert/key content to frontend, just status
      const result: any = { ...company }
      result.has_afip_cert = !!result.afip_cert
      result.has_afip_key = !!result.afip_key
      delete result.afip_cert
      delete result.afip_key
      res.json(result)
    } catch (error) {
      next(error)
    }
  }

  async updateMyCompany(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id
      // Don't allow updating certs via this endpoint
      const { afip_cert, afip_key, ...safeData } = req.body
      const company = await companiesService.updateCompany(companyId, safeData)
      res.json(company)
    } catch (error) {
      next(error)
    }
  }

  async uploadCertificates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id
      const { cert, key } = req.body

      if (!cert || !key) {
        throw new ApiError(400, 'Se requieren tanto el certificado (.pem) como la clave privada (.key)')
      }

      // Basic validation
      if (!cert.includes('BEGIN CERTIFICATE') && !cert.includes('BEGIN TRUSTED CERTIFICATE')) {
        throw new ApiError(400, 'El certificado no tiene formato PEM válido. Debe contener "BEGIN CERTIFICATE"')
      }
      if (!key.includes('BEGIN') || !key.includes('KEY')) {
        throw new ApiError(400, 'La clave privada no tiene formato PEM válido')
      }

      await companiesService.updateCompany(companyId, {
        afip_cert: cert.trim(),
        afip_key: key.trim(),
      })

      res.json({
        success: true,
        message: 'Certificados AFIP guardados correctamente',
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      next(error)
    }
  }

  async removeCertificates(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const companyId = req.user!.company_id
      await companiesService.updateCompany(companyId, {
        afip_cert: null,
        afip_key: null,
      })
      res.json({ success: true, message: 'Certificados AFIP eliminados' })
    } catch (error) {
      next(error)
    }
  }
}

export const companiesController = new CompaniesController()
