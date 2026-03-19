import { db } from '../config/db';
import { sql } from 'drizzle-orm';

/**
 * Security Monitoring Service
 *
 * Provides security dashboard data for the admin panel.
 * Tracks failed logins, suspicious activity, active sessions, and security events.
 */

// In-memory tracker for failed login attempts with details
// Used alongside the existing brute force protection in security.ts
interface FailedLoginRecord {
  email: string;
  ip: string;
  timestamp: Date;
  user_agent?: string;
}

interface SecurityEvent {
  type: 'failed_login' | 'ip_blocked' | 'suspicious_activity' | 'role_changed' | 'session_anomaly' | 'api_key_created' | 'api_key_revoked';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

// Ring buffers for in-memory tracking
const MAX_FAILED_LOGINS = 5000;
const MAX_SECURITY_EVENTS = 2000;

const failedLoginBuffer: FailedLoginRecord[] = [];
const securityEventBuffer: SecurityEvent[] = [];

// IP block list (auto-block after threshold)
const blockedIps = new Map<string, { blockedAt: Date; expiresAt: Date; reason: string }>();

// Track IPs per company for multi-company detection
const ipCompanyMap = new Map<string, Set<string>>();

/**
 * Record a failed login attempt for security monitoring.
 */
export function recordFailedLoginAttempt(email: string, ip: string, userAgent?: string): void {
  failedLoginBuffer.push({
    email,
    ip,
    timestamp: new Date(),
    user_agent: userAgent,
  });

  if (failedLoginBuffer.length > MAX_FAILED_LOGINS) {
    failedLoginBuffer.splice(0, failedLoginBuffer.length - MAX_FAILED_LOGINS);
  }

  // Check auto-block threshold: 20+ failures from same IP in 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentFromIp = failedLoginBuffer.filter(
    (r) => r.ip === ip && r.timestamp > oneHourAgo,
  );

  if (recentFromIp.length >= 20) {
    autoBlockIp(ip, '20+ failed login attempts in 1 hour');
  }
}

/**
 * Auto-block an IP for 24 hours.
 */
function autoBlockIp(ip: string, reason: string): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  blockedIps.set(ip, { blockedAt: now, expiresAt, reason });

  addSecurityEvent({
    type: 'ip_blocked',
    severity: 'high',
    message: `IP ${ip} auto-blocked: ${reason}`,
    details: { ip, reason, expires_at: expiresAt.toISOString() },
    timestamp: now,
  });
}

/**
 * Check if an IP is auto-blocked.
 */
export function isIpAutoBlocked(ip: string): { blocked: boolean; reason?: string; expiresAt?: Date } {
  const block = blockedIps.get(ip);
  if (!block) return { blocked: false };

  if (block.expiresAt < new Date()) {
    blockedIps.delete(ip);
    return { blocked: false };
  }

  return { blocked: true, reason: block.reason, expiresAt: block.expiresAt };
}

/**
 * Add a security event to the buffer.
 */
export function addSecurityEvent(event: SecurityEvent): void {
  securityEventBuffer.push(event);
  if (securityEventBuffer.length > MAX_SECURITY_EVENTS) {
    securityEventBuffer.splice(0, securityEventBuffer.length - MAX_SECURITY_EVENTS);
  }
}

/**
 * Track which company an IP is accessing (for multi-company detection).
 */
export function trackIpCompanyAccess(ip: string, companyId: string): void {
  if (!ipCompanyMap.has(ip)) {
    ipCompanyMap.set(ip, new Set());
  }
  const companies = ipCompanyMap.get(ip)!;
  companies.add(companyId);

  // Suspicious: 3+ different companies from same IP
  if (companies.size >= 3) {
    addSecurityEvent({
      type: 'suspicious_activity',
      severity: 'medium',
      message: `IP ${ip} accessing ${companies.size} different companies`,
      details: {
        ip,
        company_count: companies.size,
        company_ids: Array.from(companies),
      },
      timestamp: new Date(),
    });
  }
}

/**
 * Record a role change event.
 */
export function recordRoleChange(
  companyId: string,
  targetUserId: string,
  targetEmail: string,
  oldRole: string,
  newRole: string,
  changedBy: string,
): void {
  addSecurityEvent({
    type: 'role_changed',
    severity: newRole === 'admin' || newRole === 'owner' ? 'high' : 'medium',
    message: `Role changed: ${targetEmail} from ${oldRole} to ${newRole}`,
    details: {
      company_id: companyId,
      user_id: targetUserId,
      email: targetEmail,
      old_role: oldRole,
      new_role: newRole,
      changed_by: changedBy,
    },
    timestamp: new Date(),
  });
}

// ============================================================
// Security Dashboard Data (for admin panel)
// ============================================================

/**
 * Get failed login attempts in the last 24 hours.
 */
export function getFailedLogins24h(): {
  total: number;
  by_ip: Record<string, number>;
  by_email: Record<string, number>;
  recent: FailedLoginRecord[];
} {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = failedLoginBuffer.filter((r) => r.timestamp > twentyFourHoursAgo);

  const byIp: Record<string, number> = {};
  const byEmail: Record<string, number> = {};

  for (const record of recent) {
    byIp[record.ip] = (byIp[record.ip] || 0) + 1;
    byEmail[record.email] = (byEmail[record.email] || 0) + 1;
  }

  return {
    total: recent.length,
    by_ip: byIp,
    by_email: byEmail,
    recent: recent.slice(-50), // Last 50 attempts
  };
}

/**
 * Get active sessions count per company.
 */
export async function getActiveSessionsPerCompany(): Promise<
  Array<{ company_id: string; company_name: string; session_count: number }>
> {
  const result = await db.execute(sql`
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      COUNT(s.id)::int AS session_count
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id
    LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > NOW()
    GROUP BY c.id, c.name
    HAVING COUNT(s.id) > 0
    ORDER BY session_count DESC
    LIMIT 50
  `);
  const rows = (result as any).rows || result || [];
  return rows as Array<{ company_id: string; company_name: string; session_count: number }>;
}

/**
 * Get blocked IPs.
 */
export function getBlockedIps(): Array<{
  ip: string;
  reason: string;
  blocked_at: string;
  expires_at: string;
}> {
  const now = new Date();
  const active: Array<{ ip: string; reason: string; blocked_at: string; expires_at: string }> = [];

  for (const [ip, block] of blockedIps.entries()) {
    if (block.expiresAt > now) {
      active.push({
        ip,
        reason: block.reason,
        blocked_at: block.blockedAt.toISOString(),
        expires_at: block.expiresAt.toISOString(),
      });
    }
  }

  return active;
}

/**
 * Get recent security events.
 */
export function getSecurityEvents(limit: number = 50): SecurityEvent[] {
  return securityEventBuffer.slice(-limit);
}

/**
 * Get suspicious activity indicators.
 */
export function getSuspiciousActivity(): {
  multi_company_ips: Array<{ ip: string; company_count: number }>;
  high_failure_ips: Array<{ ip: string; failure_count: number }>;
  high_failure_emails: Array<{ email: string; failure_count: number }>;
} {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentFailures = failedLoginBuffer.filter((r) => r.timestamp > twentyFourHoursAgo);

  // Multi-company IPs
  const multiCompanyIps: Array<{ ip: string; company_count: number }> = [];
  for (const [ip, companies] of ipCompanyMap.entries()) {
    if (companies.size >= 2) {
      multiCompanyIps.push({ ip, company_count: companies.size });
    }
  }

  // High failure IPs (5+ failures in 24h)
  const ipCounts: Record<string, number> = {};
  const emailCounts: Record<string, number> = {};
  for (const r of recentFailures) {
    ipCounts[r.ip] = (ipCounts[r.ip] || 0) + 1;
    emailCounts[r.email] = (emailCounts[r.email] || 0) + 1;
  }

  const highFailureIps = Object.entries(ipCounts)
    .filter(([_, count]) => count >= 5)
    .map(([ip, count]) => ({ ip, failure_count: count }))
    .sort((a, b) => b.failure_count - a.failure_count);

  const highFailureEmails = Object.entries(emailCounts)
    .filter(([_, count]) => count >= 3)
    .map(([email, count]) => ({ email, failure_count: count }))
    .sort((a, b) => b.failure_count - a.failure_count);

  return {
    multi_company_ips: multiCompanyIps,
    high_failure_ips: highFailureIps,
    high_failure_emails: highFailureEmails,
  };
}

/**
 * Get complete security dashboard data.
 */
export async function getSecurityDashboard() {
  const [failedLogins, activeSessions] = await Promise.all([
    Promise.resolve(getFailedLogins24h()),
    getActiveSessionsPerCompany(),
  ]);

  return {
    failed_logins_24h: failedLogins,
    suspicious_activity: getSuspiciousActivity(),
    active_sessions: activeSessions,
    blocked_ips: getBlockedIps(),
    recent_events: getSecurityEvents(30),
    generated_at: new Date().toISOString(),
  };
}

// ============================================================
// Cleanup: periodically clear old entries from memory
// ============================================================

setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Clean expired blocked IPs
  const now = new Date();
  for (const [ip, block] of blockedIps.entries()) {
    if (block.expiresAt < now) {
      blockedIps.delete(ip);
    }
  }

  // Clean old IP-company mappings (keep only last hour)
  // Reset every hour to avoid stale data
  if (ipCompanyMap.size > 10000) {
    ipCompanyMap.clear();
  }

  // Trim buffers
  const cutoffLogin = failedLoginBuffer.findIndex((r) => r.timestamp > oneDayAgo);
  if (cutoffLogin > 0) {
    failedLoginBuffer.splice(0, cutoffLogin);
  }

  const cutoffEvents = securityEventBuffer.findIndex((r) => r.timestamp > oneDayAgo);
  if (cutoffEvents > 0) {
    securityEventBuffer.splice(0, cutoffEvents);
  }
}, 30 * 60 * 1000); // Every 30 minutes
