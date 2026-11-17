import { renderAgreementPdf, renderInvoicePdf, renderReceiptPdf } from './document-pdf.js';
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, type SQL } from 'drizzle-orm';
import {
  type Tx,
  addresses,
  auditLogs,
  customers,
  depositAccruals,
  sendEmail,
  users,
  edtr,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  invoiceLineItems,
  invoices,
  payments,
  projectSites,
  rentals,
  rentalAgreements,
  rentalBillingWeeks,
  fundedEquipmentDeposits,
  resolveDepositLedger,
  truckRequests,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  DepositLedgerResponse,
  EdtrDeductionEvidence,
  InvoiceDetailResponse,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoiceSummaryResponse,
  RequestContext,
  StatementEmailResponse,
  StatementOfAccount,
  StatementPdfResponse,
  StatementWeek,
} from '@arkilaunch/shared';
import { renderStatementPdf } from './statement-pdf.js';
import { tenantBrand } from '../common/tenant-brand.js';
import { personName } from '../common/field-logs.js';
import { bookingCodes, invoiceBookingRef } from '../common/booking-ref.js';
import { countRows } from '../common/count-rows.js';
import { customerOwnsInvoice, ownsCustomer } from '../common/customer-scope.js';
import { round2HalfUp } from '@arkilaunch/shared';


// Monday and Sunday of a YYYY-MM-DD report date's ISO week.
export function isoWeek(day: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  return { weekStart: d.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

function toInvoiceSummary(row: typeof invoices.$inferSelect, codes: Map<string, string>, context?: Pick<InvoiceSummaryResponse, 'customerId' | 'projectSiteId' | 'customerName' | 'location' | 'bookedBy'>): InvoiceSummaryResponse {
  return {
    id: row.id,
    rentalId: row.rentalId,
    truckRequestId: row.truckRequestId,
    bookingCode: invoiceBookingRef(row, codes)?.code ?? null,
    ...context,
    invoiceType: row.invoiceType,
    amount: Number(row.amount),
    status: row.status,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
  };
}

// Legacy fallback for rows predating invoice_line_items.reconciliation_id; the FK is preferred.
const EDTR_EVIDENCE_PATTERN =
  /^EDTR reconciliation ([0-9a-fA-F-]{36}) \(sources: ([0-9a-fA-F-]{36}), ([0-9a-fA-F-]{36}|n\/a)\)$/;

async function findEdtrEvidence(tx: Tx, lineItems: (typeof invoiceLineItems.$inferSelect)[]) {
  for (const item of lineItems) {
    if (!item.reconciliationId) continue;
    const [reconciliation] = await tx
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.id, item.reconciliationId))
      .limit(1);
    if (!reconciliation) continue;
    return {
      reconciliationId: reconciliation.id,
      sourceEdtrIds: [reconciliation.edtrId, reconciliation.counterpartEdtrId].filter(
        (id): id is string => Boolean(id),
      ),
      status: reconciliation.status,
      deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
      tolerance: Number(reconciliation.tolerance),
    } satisfies EdtrDeductionEvidence;
  }

  for (const item of lineItems) {
    const match = EDTR_EVIDENCE_PATTERN.exec(item.description);
    if (!match) continue;
    const [, reconciliationId, sourceA, sourceB] = match;
    const [reconciliation] = await tx
      .select()
      .from(edtrReconciliations)
      .where(eq(edtrReconciliations.id, reconciliationId!))
      .limit(1);
    if (!reconciliation) continue;
    return {
      reconciliationId: reconciliation.id,
      sourceEdtrIds: sourceB === 'n/a' ? [sourceA!] : [sourceA!, sourceB!],
      status: reconciliation.status,
      deltaHours: reconciliation.deltaHours !== null ? Number(reconciliation.deltaHours) : null,
      tolerance: Number(reconciliation.tolerance),
    } satisfies EdtrDeductionEvidence;
  }
  return null;
}

// The company an invoice bills: its booking's, or its truck trip's.
async function billTo(tx: Tx, invoice: typeof invoices.$inferSelect) {
  const [row] = invoice.rentalId
    ? await tx.select({ customerId: rentals.customerId }).from(rentals).where(eq(rentals.id, invoice.rentalId)).limit(1)
    : invoice.truckRequestId
      ? await tx
          .select({ customerId: truckRequests.customerId })
          .from(truckRequests)
          .where(eq(truckRequests.id, invoice.truckRequestId))
          .limit(1)
      : [];
  if (!row?.customerId) return null;
  const [company] = await tx
    .select({ companyName: customers.companyName, tin: customers.tin, billingAddress: customers.billingAddress })
    .from(customers)
    .where(eq(customers.id, row.customerId))
    .limit(1);
  return company ?? null;
}

@Injectable()
export class BillingService {
  async listInvoices(ctx: RequestContext, query: InvoiceListQuery): Promise<InvoiceListResponse> {
    return withTenantTx(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (query.rentalId) conditions.push(eq(invoices.rentalId, query.rentalId));
      if (query.invoiceType) conditions.push(eq(invoices.invoiceType, query.invoiceType));
      if (query.status) conditions.push(eq(invoices.status, query.status));
      // Manila days: [from 00:00 +08:00, the day after `to`).
      if (query.from) conditions.push(gte(invoices.createdAt, new Date(`${query.from}T00:00:00+08:00`)));
      if (query.to) conditions.push(lt(invoices.createdAt, new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + 86_400_000)));

      const rows = await tx
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const total = await countRows(tx, invoices, and(...conditions));

      const codes = await bookingCodes(tx, {
        rentalIds: rows.map((row) => row.rentalId),
        truckRequestIds: rows.map((row) => row.truckRequestId),
      });
      const rentalIds = rows.map((row) => row.rentalId).filter((id): id is string => !!id);
      const truckIds = rows.map((row) => row.truckRequestId).filter((id): id is string => !!id);
      const rentalRows = rentalIds.length
        ? await tx.select({ id: rentals.id, customerId: rentals.customerId, siteId: rentals.projectSiteId }).from(rentals).where(inArray(rentals.id, rentalIds))
        : [];
      const truckRows = truckIds.length
        ? await tx.select({ id: truckRequests.id, customerId: truckRequests.customerId, siteId: truckRequests.projectSiteId, requestedBy: truckRequests.requestedBy, dropoff: truckRequests.dropoff }).from(truckRequests).where(inArray(truckRequests.id, truckIds))
        : [];
      const bookingActors = rentalIds.length
        ? await tx.select({ rentalId: auditLogs.entityId, userId: auditLogs.actorId }).from(auditLogs)
            .where(and(eq(auditLogs.entity, 'rentals'), eq(auditLogs.action, 'CREATE'), inArray(auditLogs.entityId, rentalIds)))
        : [];
      const customerIds = [...new Set([...rentalRows, ...truckRows].map((row) => row.customerId).filter((id): id is string => !!id))];
      const customerRows = customerIds.length
        ? await tx.select({ id: customers.id, name: customers.companyName }).from(customers).where(inArray(customers.id, customerIds))
        : [];
      const siteIds = [...new Set([...rentalRows, ...truckRows].map((row) => row.siteId).filter((id): id is string => !!id))];
      const siteRows = siteIds.length
        ? await tx.select({ id: projectSites.id, line1: addresses.line1, barangay: addresses.barangay, city: addresses.city, province: addresses.province })
            .from(projectSites).innerJoin(addresses, eq(addresses.id, projectSites.addressId)).where(inArray(projectSites.id, siteIds))
        : [];
      const userIds = [...new Set([...bookingActors.map((row) => row.userId), ...truckRows.map((row) => row.requestedBy)].filter((id): id is string => !!id))];
      const userRows = userIds.length
        ? await tx.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(inArray(users.id, userIds))
        : [];
      const byRental = new Map(rentalRows.map((row) => [row.id, row]));
      const byTruck = new Map(truckRows.map((row) => [row.id, row]));
      const actorByRental = new Map(bookingActors.map((row) => [row.rentalId, row.userId]));
      const byCustomer = new Map(customerRows.map((row) => [row.id, row]));
      const bySite = new Map(siteRows.map((row) => [row.id, [row.line1, row.barangay, row.city, row.province].filter(Boolean).join(', ')]));
      const byUser = new Map(userRows.map((row) => [row.id, [row.first, row.last].filter(Boolean).join(' ')]));
      return { items: rows.map((row) => {
        const rental = row.rentalId ? byRental.get(row.rentalId) : undefined;
        const truck = row.truckRequestId ? byTruck.get(row.truckRequestId) : undefined;
        const customerId = rental?.customerId ?? truck?.customerId ?? null;
        const company = customerId ? byCustomer.get(customerId) : undefined;
        const siteId = rental?.siteId ?? truck?.siteId;
        return toInvoiceSummary(row, codes, {
          customerId,
          projectSiteId: siteId ?? null,
          customerName: company?.name ?? null,
          location: (siteId ? bySite.get(siteId) : null) || truck?.dropoff || null,
          bookedBy: (truck ? byUser.get(truck.requestedBy) : rental ? byUser.get(actorByRental.get(rental.id) ?? '') : null) || null,
        });
      }), total };
    });
  }

  async getInvoice(ctx: RequestContext, id: string): Promise<InvoiceDetailResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      // A customer reads only their own booking's or truck request's invoice; 404, not 403, so ids can't be probed.
      if (ctx.role === 'customer' && !(await customerOwnsInvoice(tx, ctx, invoice))) {
        throw new NotFoundException({ error: 'invoice_not_found' });
      }

      const lineItemRows = await tx
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, id))
        .orderBy(asc(invoiceLineItems.description), asc(invoiceLineItems.id));
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entity, 'invoices'), eq(auditLogs.entityId, id)))
        .orderBy(desc(auditLogs.timestamp));

      const edtrEvidence = invoice.invoiceType === 'deposit_deduction' ? await findEdtrEvidence(tx, lineItemRows) : null;
      const [receipt] = await tx
        .select({ receiptNo: payments.receiptNo })
        .from(payments)
        .where(and(eq(payments.invoiceId, id), eq(payments.status, 'paid'), isNotNull(payments.receiptNo)))
        .limit(1);

      const [weekSnapshot] = invoice.rentalId && invoice.billingWeekStart && ['weekly', 'weekly_correction'].includes(invoice.invoiceType)
        ? await tx.select().from(rentalBillingWeeks)
            .where(and(eq(rentalBillingWeeks.tenantId, ctx.tenantId), eq(rentalBillingWeeks.rentalId, invoice.rentalId), eq(rentalBillingWeeks.weekStart, invoice.billingWeekStart))).limit(1)
        : [];
      let rentalStatement: InvoiceDetailResponse['rentalStatement'] = null;
      if (invoice.rentalId) {
        const [rental] = await tx.select({ siteId: rentals.projectSiteId }).from(rentals)
          .where(and(eq(rentals.tenantId, ctx.tenantId), eq(rentals.id, invoice.rentalId))).limit(1);
        const [site] = rental ? await tx.select({ line1: addresses.line1, barangay: addresses.barangay, city: addresses.city, province: addresses.province })
          .from(projectSites).innerJoin(addresses, eq(addresses.id, projectSites.addressId))
          .where(and(eq(projectSites.tenantId, ctx.tenantId), eq(projectSites.id, rental.siteId))).limit(1) : [];
        const lineIds = lineItemRows.map((line) => line.equipmentId).filter((value): value is string => !!value);
        const assignmentIds = lineIds.length ? [] : await tx.select({ equipmentId: equipmentAssignments.equipmentId })
          .from(equipmentAssignments).where(and(eq(equipmentAssignments.tenantId, ctx.tenantId), eq(equipmentAssignments.rentalId, invoice.rentalId)));
        const ids = [...new Set([...lineIds, ...assignmentIds.map((row) => row.equipmentId)])];
        const units = ids.length ? await tx.select({ id: equipment.id, typeName: equipmentTypes.name, model: equipment.model, serialNo: equipment.serialNo })
          .from(equipment).innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
          .where(and(eq(equipment.tenantId, ctx.tenantId), inArray(equipment.id, ids))) : [];
        rentalStatement = {
          jobSite: weekSnapshot?.siteSnapshot.display ?? (site ? [site.line1, site.barangay, site.city, site.province].filter(Boolean).join(', ') : '—'),
          equipment: weekSnapshot && ['weekly', 'weekly_correction'].includes(invoice.invoiceType) ? weekSnapshot.usageLines
            .filter((unit) => invoice.invoiceType === 'weekly' || lineIds.includes(unit.equipmentId))
            .map((unit) => `${unit.label} (SN ${unit.serialNo})`)
            : units.map((unit) => `${unit.typeName} ${unit.model} (SN ${unit.serialNo})`),
          weekStart: weekSnapshot?.weekStart ?? null,
          weekEnd: weekSnapshot ? new Date(new Date(`${weekSnapshot.weekStart}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10) : null,
          usageLines: invoice.invoiceType === 'weekly' ? weekSnapshot?.usageLines ?? [] : [],
        };
      }

      return {
        ...toInvoiceSummary(
          invoice,
          await bookingCodes(tx, { rentalIds: [invoice.rentalId], truckRequestIds: [invoice.truckRequestId] }),
        ),
        lineItems: lineItemRows.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.amount),
        })),
        rentalStatement,
        billTo: weekSnapshot?.billToSnapshot ?? await billTo(tx, invoice),
        edtrEvidence,
        receiptNo: receipt?.receiptNo ?? null,
        auditTrail: auditRows.map((row) => ({ action: row.action, actorId: row.actorId, timestamp: row.timestamp })),
      };
    });
  }

  // resolveDepositLedger, same as the approve gate, so the two never disagree.
  async depositLedger(ctx: RequestContext, rentalId: string): Promise<DepositLedgerResponse> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'rental_not_found' });

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      let fundedRequired = ledger.depositRequired;
      if (rental.depositMode === 'per_machine') {
        const funded = await fundedEquipmentDeposits(tx, ctx.tenantId, rentalId);
        fundedRequired = round2HalfUp([...funded.values()].reduce((sum, amount) => sum + amount, 0));
      }
      return {
        rentalId,
        depositRequired: ledger.depositRequired,
        totalDeducted: ledger.totalDeducted,
        balanceRemaining: round2HalfUp(Math.max(0, fundedRequired - ledger.totalDeducted)),
        unbilledAccrued: ledger.unbilledAccrued,
        hoursUsed: ledger.hoursUsed,
        hoursOrdered: ledger.hoursOrdered,
        deductions: ledger.deductions,
      };
    });
  }

  async statement(ctx: RequestContext, rentalId: string): Promise<StatementOfAccount> {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental || (ctx.role === 'customer' && !(await ownsCustomer(tx, ctx, rental.customerId)))) {
        throw new NotFoundException({ error: 'rental_not_found' });
      }
      const [company] = await tx
        .select({ name: customers.companyName, tin: customers.tin, billingAddress: customers.billingAddress })
        .from(customers)
        .where(eq(customers.id, rental.customerId))
        .limit(1);

      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, rentalId), ne(invoices.status, 'void')))
        .orderBy(asc(invoices.createdAt));
      const paymentRows = invoiceRows.length
        ? await tx
            .select()
            .from(payments)
            .where(inArray(payments.invoiceId, invoiceRows.map((i) => i.id)))
            .orderBy(asc(payments.createdAt))
        : [];

      // Each charge's work day, via its reconciliation's EDTR.
      const deductionIds = invoiceRows.filter((i) => i.invoiceType === 'deposit_deduction').map((i) => i.id);
      const deducted = deductionIds.length
        ? await tx
            .select({ hours: invoiceLineItems.quantity, amount: invoiceLineItems.amount, day: edtr.reportDate, equipmentId: edtr.equipmentId })
            .from(invoiceLineItems)
            .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
            .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
            .where(and(inArray(invoiceLineItems.invoiceId, deductionIds), isNotNull(invoiceLineItems.reconciliationId)))
        : [];
      const accrued = await tx
        .select({ id: depositAccruals.id, hours: depositAccruals.hours, amount: depositAccruals.amount, invoiceId: depositAccruals.invoiceId, day: edtr.reportDate, equipmentId: edtr.equipmentId })
        .from(depositAccruals)
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(eq(depositAccruals.rentalId, rentalId));

      const equipmentIds = [...new Set([...deducted, ...accrued].map((row) => row.equipmentId))];
      const unitRows = equipmentIds.length ? await tx.select({ id: equipment.id, serialNo: equipment.serialNo, model: equipment.model, typeName: equipmentTypes.name })
        .from(equipment).innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
        .where(and(eq(equipment.tenantId, ctx.tenantId), inArray(equipment.id, equipmentIds))) : [];
      const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
      const correctionAudits = await tx.select({ reason: auditLogs.reason }).from(auditLogs)
        .where(and(eq(auditLogs.tenantId, ctx.tenantId), eq(auditLogs.entity, 'edtr_late_correction')));
      const correctionInvoiceIds = new Set(invoiceRows.filter((invoice) => invoice.invoiceType === 'weekly_correction').map((invoice) => invoice.id));
      const corrections = correctionAudits.flatMap((audit) => {
        try {
          const payload = JSON.parse(audit.reason ?? '') as { reason?: string; rentalId?: string; equipmentId?: string; day?: string; grossPhp?: number; depositAppliedPhp?: number; invoiceId?: string | null };
          if (payload.rentalId !== rentalId || !payload.equipmentId || !payload.day || !payload.reason) return [];
          if (payload.invoiceId && !correctionInvoiceIds.has(payload.invoiceId)) return [];
          if (!payload.invoiceId && !equipmentIds.includes(payload.equipmentId)) return [];
          const unit = unitById.get(payload.equipmentId);
          return [{ equipmentId: payload.equipmentId, label: unit ? `${unit.typeName} ${unit.model}` : 'Equipment', serialNo: unit?.serialNo ?? payload.equipmentId,
            day: payload.day, gross: payload.grossPhp ?? 0, fromDeposit: payload.depositAppliedPhp ?? 0, invoiceId: payload.invoiceId ?? null, reason: payload.reason }];
        } catch { return []; }
      });
      const capById = rental.depositMode === 'per_machine'
        ? await fundedEquipmentDeposits(tx, ctx.tenantId, rentalId) : new Map<string, number>();
      const weeks = new Map<string, StatementWeek>();
      const week = (day: string) => {
        const w = isoWeek(day);
        let row = weeks.get(w.weekStart);
        if (!row) {
          row = { ...w, hours: 0, amount: 0, fromDeposit: 0, invoiced: 0, unbilled: 0, customerPays: 0, paid: 0, outstanding: 0 };
          weeks.set(w.weekStart, row);
        }
        return row;
      };
      const machine = (row: StatementWeek, equipmentId: string) => {
        row.machines ??= [];
        let line = row.machines.find((entry) => entry.equipmentId === equipmentId);
        if (!line) {
          const unit = unitById.get(equipmentId);
          line = { equipmentId, label: unit ? `${unit.typeName} ${unit.model}` : 'Equipment', serialNo: unit?.serialNo ?? equipmentId,
            hours: 0, amount: 0, fromDeposit: 0, invoiced: 0, unbilled: 0, paid: 0, outstanding: 0,
            depositRemaining: null, invoiceId: null };
          row.machines.push(line);
        }
        return line;
      };
      for (const d of deducted) {
        const row = week(d.day);
        const unit = machine(row, d.equipmentId);
        row.hours = round2HalfUp(row.hours + Number(d.hours));
        row.amount = round2HalfUp(row.amount + Number(d.amount));
        row.fromDeposit = round2HalfUp(row.fromDeposit + Number(d.amount));
        unit.hours = round2HalfUp(unit.hours + Number(d.hours));
        unit.amount = round2HalfUp(unit.amount + Number(d.amount));
        unit.fromDeposit = round2HalfUp(unit.fromDeposit + Number(d.amount));
      }
      // Each weekly invoice's paid share, spread over the hours it billed.
      const paidByInvoice = new Map<string, number>();
      for (const p of paymentRows) {
        if (p.status === 'paid') paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + Number(p.amount));
        if (p.status === 'refunded') paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) - Number(p.amount));
      }
      const paidForAccrual = new Map<string, number>();
      for (const invoice of invoiceRows.filter((item) => ['weekly', 'weekly_correction'].includes(item.invoiceType))) {
        const lines = accrued.filter((item) => item.invoiceId === invoice.id).sort((a, b) => a.equipmentId.localeCompare(b.equipmentId) || a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
        const chargeCents = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0);
        const paidCents = Math.max(0, Math.min(chargeCents, Math.round((paidByInvoice.get(invoice.id) ?? 0) * 100)));
        if (!chargeCents || !paidCents) continue;
        const shares = lines.map((line) => {
          const exact = paidCents * Math.round(Number(line.amount) * 100) / chargeCents;
          return { id: line.id, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
        });
        let leftover = paidCents - shares.reduce((sum, line) => sum + line.cents, 0);
        for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id))) {
          if (leftover-- <= 0) break;
          share.cents += 1;
        }
        for (const share of shares) paidForAccrual.set(share.id, share.cents / 100);
      }
      for (const a of accrued) {
        const row = week(a.day);
        const unit = machine(row, a.equipmentId);
        if (a.invoiceId) row.paid = round2HalfUp(row.paid + (paidForAccrual.get(a.id) ?? 0));
        if (a.invoiceId) unit.paid = round2HalfUp(unit.paid + (paidForAccrual.get(a.id) ?? 0));
        row.hours = round2HalfUp(row.hours + Number(a.hours));
        row.amount = round2HalfUp(row.amount + Number(a.amount));
        unit.hours = round2HalfUp(unit.hours + Number(a.hours));
        unit.amount = round2HalfUp(unit.amount + Number(a.amount));
        if (a.invoiceId) row.invoiced = round2HalfUp(row.invoiced + Number(a.amount));
        else row.unbilled = round2HalfUp(row.unbilled + Number(a.amount));
        if (a.invoiceId) { unit.invoiced = round2HalfUp(unit.invoiced + Number(a.amount)); unit.invoiceId = a.invoiceId; row.invoiceId = a.invoiceId; }
        else unit.unbilled = round2HalfUp(unit.unbilled + Number(a.amount));
      }

      const usedByUnit = new Map<string, number>();
      for (const row of [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))) {
        const invoiceIds = [...new Set(accrued.filter((item) => isoWeek(item.day).weekStart === row.weekStart && item.invoiceId).map((item) => item.invoiceId!))];
        row.invoiceId = invoiceIds.find((id) => invoiceRows.find((invoice) => invoice.id === id)?.invoiceType === 'weekly') ?? null;
        row.correctionInvoiceIds = invoiceIds.filter((id) => invoiceRows.find((invoice) => invoice.id === id)?.invoiceType === 'weekly_correction');
        row.customerPays = round2HalfUp(row.invoiced + row.unbilled);
        row.outstanding = round2HalfUp(Math.max(0, row.customerPays - row.paid));
        for (const unit of row.machines ?? []) {
          const unitInvoiceIds = [...new Set(accrued.filter((item) => isoWeek(item.day).weekStart === row.weekStart && item.equipmentId === unit.equipmentId && item.invoiceId).map((item) => item.invoiceId!))];
          unit.invoiceId = unitInvoiceIds.find((id) => invoiceRows.find((invoice) => invoice.id === id)?.invoiceType === 'weekly') ?? null;
          unit.correctionInvoiceIds = unitInvoiceIds.filter((id) => invoiceRows.find((invoice) => invoice.id === id)?.invoiceType === 'weekly_correction');
          unit.outstanding = round2HalfUp(Math.max(0, unit.invoiced + unit.unbilled - unit.paid));
          const used = round2HalfUp((usedByUnit.get(unit.equipmentId) ?? 0) + unit.fromDeposit);
          usedByUnit.set(unit.equipmentId, used);
          unit.depositRemaining = capById.has(unit.equipmentId) ? round2HalfUp(Math.max(0, capById.get(unit.equipmentId)! - used)) : null;
        }
      }

      const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
      const charged = round2HalfUp(invoiceRows.filter((i) => i.invoiceType !== 'deposit_deduction').reduce((sum, i) => sum + Number(i.amount), 0));
      const paid = round2HalfUp(paymentRows.reduce((sum, p) => sum + (p.status === 'paid' ? Number(p.amount) : p.status === 'refunded' ? -Number(p.amount) : 0), 0));
      return {
        rentalId,
        bookingCode: rental.code,
        status: rental.status,
        rentalStart: rental.startDate.toISOString(),
        rentalEnd: rental.endDate?.toISOString() ?? null,
        company: company ?? null,
        weeks: [...weeks.values()].sort((x, y) => x.weekStart.localeCompare(y.weekStart)),
        invoices: invoiceRows.map((i) => ({
          id: i.id,
          invoiceType: i.invoiceType,
          amount: Number(i.amount),
          status: i.status,
          createdAt: i.createdAt.toISOString(),
          dueDate: i.dueDate.toISOString(),
        })),
        payments: paymentRows.map((p) => ({
          id: p.id,
          invoiceId: p.invoiceId,
          method: p.method,
          amount: Number(p.amount),
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
        corrections,
        deposit: {
          required: ledger.depositRequired,
          deducted: ledger.totalDeducted,
          remaining: rental.depositMode === 'per_machine' ? round2HalfUp(Math.max(0, [...capById.values()].reduce((sum, amount) => sum + amount, 0) - ledger.totalDeducted))
            : round2HalfUp(Math.max(0, ledger.depositRequired - ledger.totalDeducted)),
        },
        totals: {
          charged,
          paid,
          unbilled: ledger.unbilledAccrued,
          balanceDue: round2HalfUp(Math.max(0, charged - paid) + ledger.unbilledAccrued),
        },
        generatedAt: new Date().toISOString(),
        lastEmailed: ctx.role === 'customer' ? null : await lastStatementEmail(tx, rentalId),
      };
    });
  }

  async invoicePdf(ctx: RequestContext, id: string, receipt = false): Promise<StatementPdfResponse> {
    const invoice = await this.getInvoice(ctx,id);
    const brand = await this.brand(ctx);
    const paid = receipt ? await withTenantTx(ctx, tx => tx.select().from(payments).where(and(eq(payments.invoiceId,id),eq(payments.status,'paid'))).orderBy(payments.createdAt,payments.id)) : [];
    if (receipt && paid.length === 0) throw new NotFoundException({error:'successful_payment_not_found'});
    const bytes = receipt ? await renderReceiptPdf(invoice,paid,brand) : await renderInvoicePdf(invoice,brand);
    return {filename:`${receipt?'receipt':'invoice'}-${id}.pdf`,contentBase64:Buffer.from(bytes).toString('base64')};
  }

  async agreementPdf(ctx:RequestContext,rentalId:string,agreementId?:string):Promise<StatementPdfResponse> {
    const result=await withTenantTx(ctx, async tx=>{
      const [rental]=await tx.select().from(rentals).where(eq(rentals.id,rentalId));
      if(!rental || (ctx.role==='customer' && !(await ownsCustomer(tx,ctx,rental.customerId))))throw new NotFoundException({error:'booking_not_found'});
      const [agreement]=await tx.select().from(rentalAgreements).where(and(eq(rentalAgreements.rentalId,rentalId),...(agreementId?[eq(rentalAgreements.id,agreementId)]:[]))).orderBy(desc(rentalAgreements.signedAt),desc(rentalAgreements.id)).limit(1);
      if(!agreement)throw new NotFoundException({error:'signed_agreement_not_found'});
      return {rental,agreement};
    });
    const bytes=await renderAgreementPdf(result.agreement,result.rental.code,await this.brand(ctx));
    return {filename:`agreement-${result.rental.code}.pdf`,contentBase64:Buffer.from(bytes).toString('base64')};
  }

  async statementPdf(ctx: RequestContext, rentalId: string): Promise<StatementPdfResponse> {
    const soa = await this.statement(ctx, rentalId);
    const bytes = await renderStatementPdf(soa, await this.brand(ctx));
    return { filename: `soa-${soa.bookingCode ?? rentalId}.pdf`, contentBase64: Buffer.from(bytes).toString('base64') };
  }

  // The office sends the PDF by hand after checking it; the customer's account email receives it.
  async emailStatement(ctx: RequestContext, rentalId: string): Promise<StatementEmailResponse> {
    const soa = await this.statement(ctx, rentalId);
    const to = await withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .select({ email: users.email })
        .from(rentals)
        .innerJoin(customers, eq(customers.id, rentals.customerId))
        .innerJoin(users, eq(users.id, customers.userId))
        .where(eq(rentals.id, rentalId))
        .limit(1);
      return row?.email ?? null;
    });
    if (!to) throw new UnprocessableEntityException({ error: 'customer_email_missing' });
    const brand = await this.brand(ctx);
    const pdf = await renderStatementPdf(soa, brand);
    const code = soa.bookingCode ?? rentalId;
    await sendEmail(
      to,
      `Statement of Account ${code} from ${brand.name}`,
      `Attached is the Statement of Account for booking ${code}. Balance due: PHP ${soa.totals.balanceDue.toFixed(2)}.`,
      undefined,
      [{ filename: `soa-${code}.pdf`, content: Buffer.from(pdf).toString('base64') }],
    );
    const sentAt = new Date();
    await withTenantTx(ctx, (tx) =>
      tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'CREATE', entity: 'statement_emailed', entityId: rentalId, timestamp: sentAt }),
    );
    return { sentTo: to, sentAt: sentAt.toISOString() };
  }

  private brand(ctx: RequestContext) {
    return tenantBrand(ctx);
  }
}

async function lastStatementEmail(tx: Tx, rentalId: string) {
  const [row] = await tx
    .select({ at: auditLogs.timestamp, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, 'statement_emailed'), eq(auditLogs.entityId, rentalId)))
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);
  return row ? { at: row.at.toISOString(), by: row.email ? (personName({ firstName: row.firstName, lastName: row.lastName, email: row.email }) ?? null) : null } : null;
}
