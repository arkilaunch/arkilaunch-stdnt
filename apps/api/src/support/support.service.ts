import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, ilike, inArray, or, sql } from 'drizzle-orm';
import { customers, rentals, roles, supportTickets, users, withTenantTx, type Tx } from '@arkilaunch/db';
import type { RequestContext, TicketCreate, TicketListQuery, TicketPatch } from '@arkilaunch/shared';
import { notifyStaff, notifyUser } from '../common/notify-customer.js';

@Injectable()
export class SupportService {
  private customer(ctx: RequestContext) {
    if (ctx.role !== 'customer') throw new ForbiddenException();
  }
  private staff(ctx: RequestContext) {
    if (ctx.role !== 'admin' && ctx.role !== 'owner') throw new ForbiddenException();
  }
  private query(tx: Tx) {
    return tx.select({ ...getTableColumns(supportTickets), agentName: users.email })
      .from(supportTickets).leftJoin(users, eq(users.id, supportTickets.assignedTo));
  }
  create(ctx: RequestContext, body: TicketCreate) {
    this.customer(ctx);
    return withTenantTx(ctx, async (tx) => {
      if (body.bookingId) {
        const [booking] = await tx.select({ id: rentals.id }).from(rentals)
          .innerJoin(customers, eq(customers.id, rentals.customerId))
          .where(and(eq(rentals.id, body.bookingId), eq(customers.userId, ctx.userId))).limit(1);
        if (!booking) throw new BadRequestException({ error: 'booking_not_owned' });
      }
      // Serializes code allocation for this tenant; rollback releases the lock and number.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId}, 81))`);
      const [total] = await tx.select({ value: count() }).from(supportTickets);
      const code = `ST-${String((total?.value ?? 0) + 1).padStart(4, '0')}`;
      const [ticket] = await tx.insert(supportTickets).values({
        tenantId: ctx.tenantId, createdBy: ctx.userId, code, ...body,
      }).returning();
      await notifyStaff(tx, ctx.tenantId, 'support_ticket_created', { ticket_id: ticket!.id, ticket_code: code });
      return { ...ticket!, agentName: null };
    });
  }
  mine(ctx: RequestContext) {
    this.customer(ctx);
    return withTenantTx(ctx, (tx) => this.query(tx).where(eq(supportTickets.createdBy, ctx.userId)).orderBy(desc(supportTickets.createdAt)));
  }
  detail(ctx: RequestContext, id: string, own = false) {
    if (own) this.customer(ctx); else this.staff(ctx);
    return withTenantTx(ctx, async (tx) => {
      const [ticket] = await this.query(tx).where(and(eq(supportTickets.id, id), own ? eq(supportTickets.createdBy, ctx.userId) : undefined)).limit(1);
      if (!ticket) throw new NotFoundException();
      return ticket;
    });
  }
  list(ctx: RequestContext, query: TicketListQuery) {
    this.staff(ctx);
    return withTenantTx(ctx, async (tx) => {
      const term = query.search?.replace(/[\\%_]/g, '\\$&');
      const condition = and(query.status ? eq(supportTickets.status, query.status) : undefined,
        term ? or(ilike(supportTickets.subject, `%${term}%`), ilike(supportTickets.code, `%${term.replace(/^#/, '')}%`)) : undefined);
      const items = await this.query(tx).where(condition).orderBy(desc(supportTickets.createdAt), desc(supportTickets.id)).limit(query.limit).offset(query.offset);
      const [total] = await tx.select({ value: count() }).from(supportTickets).where(condition);
      return { items, total: total?.value ?? 0 };
    });
  }
  patch(ctx: RequestContext, id: string, body: TicketPatch) {
    this.staff(ctx);
    return withTenantTx(ctx, async (tx) => {
      const [existing] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');
      if (!existing) throw new NotFoundException();
      if (body.assignedTo) {
        const [assignee] = await tx.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
          .where(and(eq(users.id, body.assignedTo), eq(users.tenantId, ctx.tenantId), eq(users.status, 'active'), inArray(roles.name, ['admin', 'owner']))).limit(1);
        if (!assignee) throw new BadRequestException({ error: 'invalid_support_agent' });
      }
      await tx.update(supportTickets).set({ ...body, updatedAt: new Date() }).where(eq(supportTickets.id, id));
      if (body.status && body.status !== existing.status) {
        await notifyUser(tx, ctx.tenantId, existing.createdBy, 'support_ticket_status_changed', {
          ticket_id: id, ticket_code: existing.code, status: body.status,
        });
      }
      const [ticket] = await this.query(tx).where(eq(supportTickets.id, id));
      return ticket!;
    });
  }
}
