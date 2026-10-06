import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Tx, roles, timekeeperSiteAssignments, users } from '@arkilaunch/db';

// The FK alone would accept another tenant's user id; only a timekeeper of this tenant can hold a site.
export async function requireTimekeeper(tx: Tx, tenantId: string, userId: string) {
  const [user] = await tx
    .select({ id: users.id, role: roles.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!user) throw new NotFoundException({ error: 'user_not_found' });
  if (user.role !== 'timekeeper') throw new UnprocessableEntityException({ error: 'role_has_no_site_assignments' });
}

export async function assignTimekeeperToSite(tx: Tx, tenantId: string, userId: string, projectSiteId: string) {
  await requireTimekeeper(tx, tenantId, userId);
  await tx.insert(timekeeperSiteAssignments).values({ tenantId, userId, projectSiteId }).onConflictDoNothing();
}
