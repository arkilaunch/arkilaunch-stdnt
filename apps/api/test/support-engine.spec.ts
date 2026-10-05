import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { supportTickets, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { SupportService } from '../src/support/support.service.js';
import { SupportController } from '../src/support/support.controller.js';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator.js';

describe('support ownership, staff workflow and RLS', () => {
  const service = new SupportService();
  let direct: ReturnType<typeof postgres>;
  let a: RequestContext, other: RequestContext, b: RequestContext, staff: RequestContext, staffB: RequestContext;
  let ownBooking: string, foreignBooking: string;
  const ids: string[] = [];
  const subject = `Support QA ${randomUUID()}`;
  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT!;
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Support tests require a local database');
    direct = postgres(url, { max: 1 });
    const accounts = await direct`select u.id,u.tenant_id,r.name role,u.email from users u join roles r on r.id=u.role_id where u.email in ('customer@test-tenant-a.test','customer@test-tenant-b.test','admin@test-tenant-a.test','admin@test-tenant-b.test')`;
    const ctx = (email: string) => { const user = accounts.find((row) => row.email === email)!; return { tenantId: user.tenant_id, userId: user.id, role: user.role } as RequestContext; };
    a = ctx('customer@test-tenant-a.test'); b = ctx('customer@test-tenant-b.test'); staff = ctx('admin@test-tenant-a.test'); staffB = ctx('admin@test-tenant-b.test');
    const [user] = await direct`insert into users(tenant_id,role_id,email,password_hash,status) select tenant_id,role_id,${`support-${randomUUID()}@example.test`},password_hash,'active' from users where id=${a.userId} returning id`;
    other = { ...a, userId: user!.id };
    const [own] = await direct`select r.id from rentals r join customers c on c.id=r.customer_id where c.user_id=${a.userId} limit 1`;
    const [foreign] = await direct`select r.id from rentals r join customers c on c.id=r.customer_id where c.user_id=${b.userId} limit 1`;
    ownBooking = own!.id; foreignBooking = foreign!.id;
  }, 120_000);
  afterAll(async () => {
    if (!direct) return;
    if (ids.length) {
      await direct`delete from notifications where payload->>'ticket_id'=any(${ids})`;
      await direct`delete from support_tickets where id=any(${ids}::uuid[])`;
    }
    if (other) await direct`delete from users where id=${other.userId}`;
    await direct.end();
  });
  it('creates an owned ticket, isolates customer lists and notifies staff', async () => {
    const ticket = await service.create(a, { category: 'payment', subject, message: '<script>inert text</script>', bookingId: ownBooking }); ids.push(ticket.id);
    expect(ticket.code).toMatch(/^ST-\d{4,}$/);
    expect(ticket.priority).toBe('medium'); expect(ticket.status).toBe('open');
    expect((await service.mine(a)).some((t) => t.id === ticket.id)).toBe(true);
    expect((await service.mine(other)).some((t) => t.id === ticket.id)).toBe(false);
    await expect(service.detail(other, ticket.id, true)).rejects.toThrow(NotFoundException);
    await expect(service.detail(b, ticket.id, true)).rejects.toThrow(NotFoundException);
    await expect(service.detail(staffB, ticket.id)).rejects.toThrow(NotFoundException);
    expect(await withTenantTx(b, (tx) => tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)))).toHaveLength(0);
    const notices = await direct`select id from notifications where user_id=${staff.userId} and notification_type='support_ticket_created' and payload->>'ticket_id'=${ticket.id}`;
    expect(notices.length).toBe(1);
  });
  it('refuses booking attachment for another customer or tenant', async () => {
    const body = { category: 'payment' as const, subject, message: 'Please help' };
    await expect(service.create(other, { ...body, bookingId: ownBooking })).rejects.toThrow(BadRequestException);
    await expect(service.create(a, { ...body, bookingId: foreignBooking })).rejects.toThrow(BadRequestException);
  });
  it('supports staff search/filter/paging/assignment/status updates and customer notifications', async () => {
    const id = ids[0]!;
    const found = await service.list(staff, { search: subject, status: 'open', limit: 1, offset: 0 });
    expect(found.total).toBe(1); expect(found.items[0]!.id).toBe(id);
    expect((await service.list(staff, { search: found.items[0]!.code, limit: 10, offset: 0 })).total).toBe(1);
    expect((await service.list(staff, { search: subject, limit: 1, offset: 1 })).items).toHaveLength(0);
    await expect(service.patch(staff, id, { assignedTo: a.userId })).rejects.toThrow(BadRequestException);
    await expect(service.patch(staff, id, { assignedTo: staffB.userId })).rejects.toThrow(BadRequestException);
    await expect(service.patch(staffB, id, { status: 'resolved' })).rejects.toThrow(NotFoundException);
    const updated = await service.patch(staff, id, { status: 'in_progress', priority: 'high', assignedTo: staff.userId });
    expect(updated.status).toBe('in_progress'); expect(updated.assignedTo).toBe(staff.userId);
    expect((await service.list(staff, { search: subject, status: 'open', limit: 10, offset: 0 })).total).toBe(0);
    const notices = await direct`select id from notifications where user_id=${a.userId} and notification_type='support_ticket_status_changed' and payload->>'ticket_id'=${id}`;
    expect(notices.length).toBe(1);
    await service.patch(staff, id, { status: 'in_progress' });
    expect((await direct`select id from notifications where notification_type='support_ticket_status_changed' and payload->>'ticket_id'=${id}`).length).toBe(1);
  });
  it('denies customer staff operations and guards HTTP endpoints with existing permission', async () => {
    expect(() => service.list(a, { limit: 10, offset: 0 })).toThrow(ForbiddenException);
    expect(() => service.patch(a, ids[0]!, { status: 'closed' })).toThrow(ForbiddenException);
    for (const method of ['list', 'detail', 'patch'] as const) expect(Reflect.getMetadata(PERMISSION_KEY, SupportController.prototype[method])).toEqual(['user:manage']);
  });
  it('allocates distinct codes under concurrent submissions', async () => {
    const tickets = await Promise.all([1, 2, 3].map((n) => service.create(a, { category: 'other', subject: `${subject} ${n}`, message: 'Concurrent ticket' })));
    ids.push(...tickets.map((t) => t.id));
    expect(new Set(tickets.map((t) => t.code)).size).toBe(3);
  });
});
