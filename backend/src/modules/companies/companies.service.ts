import { db } from '../../config/db';
import { companies } from '../../db/schema';
import { eq } from 'drizzle-orm'

export class CompaniesService {
  async getCompanyById(companyId: string) {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    })

    return company
  }

  async updateCompany(companyId: string, data: any) {
    const updated = await db
      .update(companies)
      .set(data)
      .where(eq(companies.id, companyId))
      .returning()

    return updated[0]
  }
}

export const companiesService = new CompaniesService()
