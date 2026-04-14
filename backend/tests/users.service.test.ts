import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

// Mock security monitor (side-effect only)
vi.mock('../src/lib/security-monitor', () => ({
  recordRoleChange: vi.fn(),
}))

// Mock role templates / hierarchy so applyTemplate has something to resolve
vi.mock('../src/shared/permissions.constants', () => ({
  ROLE_TEMPLATES: {
    admin: { users: ['view', 'edit'] },
  },
  ROLE_HIERARCHY: {
    owner: 3,
    admin: 2,
    user: 1,
  },
}))

import { UsersService } from '../src/modules/users/users.service'

describe('UsersService IDOR protection (cross-company)', () => {
  let svc: UsersService

  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
    svc = new UsersService()
  })

  it('rejects setUserPermissions for user in different company', async () => {
    // Caller is in company-A, target user lives in company-B.
    // The ownership SELECT returns zero rows.
    mockDbExecute.mockResolvedValueOnce({ rows: [] })

    await expect(
      svc.setUserPermissions('company-A', 'user-in-company-B', { users: ['view'] })
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('no encontrado'),
    })

    // Only the ownership check ran. No DELETE, no INSERT.
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('rejects applyTemplate for user in different company', async () => {
    // Ownership SELECT returns zero rows.
    mockDbExecute.mockResolvedValueOnce({ rows: [] })

    await expect(
      svc.applyTemplate('company-A', 'user-in-company-B', 'admin')
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('no encontrado'),
    })

    // Pool query (for role_templates) should never be called because we bail early.
    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('allows setUserPermissions when target user belongs to caller company', async () => {
    // 1) ownership check -> match, 2) DELETE permissions, 3) INSERT (one perm),
    // 4) getUserPermissions SELECT at the end
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 'user-A' }] }) // ownership
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ module: 'users', action: 'view' }] }) // getUserPermissions

    const result = await svc.setUserPermissions('company-A', 'user-A', { users: ['view'] })

    expect(result).toEqual({ users: ['view'] })
    expect(mockDbExecute).toHaveBeenCalledTimes(4)
  })
})
