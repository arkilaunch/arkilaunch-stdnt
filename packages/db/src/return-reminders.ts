import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { DEFAULT_RETURN_REMINDERS, type ReturnReminderSettings } from '@arkilaunch/shared';
import type { Executor } from './with-tenant-tx.js';
import { customers } from './schema/customers.js';
import { equipment, equipmentTypes } from './schema/fleet.js';
import { equipmentAssignments, rentals, returnReminderSettings } from './schema/rentals.js';

// No row means the baseline (5, 3, 1 + overdue).
export async function getReturnReminderSettings(ex: Executor, tenantId: string): Promise<ReturnReminderSettings> {
  const [row] = await ex
    .select({ daysBefore: returnReminderSettings.daysBefore, overdue: returnReminderSettings.overdue })
    .from(returnReminderSettings)
    .where(eq(returnReminderSettings.tenantId, tenantId))
    .limit(1);
  return row ? { daysBefore: row.daysBefore as ReturnReminderSettings['daysBefore'], overdue: row.overdue } : DEFAULT_RETURN_REMINDERS;
}

export interface DueAssignment {
  tenantId: string;
  rentalId: string;
  code: string | null;
  customerId: string;
  customerName: string | null;
  assignmentId: string;
  equipmentId: string;
  equipmentLabel: string;
  end: Date;
}

// Machines still out on a live rental whose return is before `until` (overdue ones included).
// The job passes no tenant (its connection bypasses RLS); every row carries its own tenant_id.
export async function dueAssignments(ex: Executor, until: Date, tenantId?: string): Promise<DueAssignment[]> {
  const rows = await ex
    .select({
      tenantId: equipmentAssignments.tenantId,
      rentalId: rentals.id,
      code: rentals.code,
      customerId: rentals.customerId,
      customerName: customers.companyName,
      assignmentId: equipmentAssignments.id,
      equipmentId: equipment.id,
      typeName: equipmentTypes.name,
      model: equipment.model,
      serialNo: equipment.serialNo,
      end: equipmentAssignments.end,
    })
    .from(equipmentAssignments)
    .innerJoin(
      rentals,
      and(eq(rentals.id, equipmentAssignments.rentalId), eq(rentals.tenantId, equipmentAssignments.tenantId)),
    )
    .innerJoin(customers, and(eq(customers.id, rentals.customerId), eq(customers.tenantId, rentals.tenantId)))
    .innerJoin(
      equipment,
      and(eq(equipment.id, equipmentAssignments.equipmentId), eq(equipment.tenantId, equipmentAssignments.tenantId)),
    )
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(
      and(
        tenantId ? eq(equipmentAssignments.tenantId, tenantId) : undefined,
        eq(equipmentAssignments.status, 'active'),
        eq(rentals.status, 'active'),
        isNotNull(equipmentAssignments.end),
        lt(equipmentAssignments.end, until),
      ),
    )
    .orderBy(asc(equipmentAssignments.end));
  return rows.map(({ typeName, model, serialNo, ...row }) => ({
    ...row,
    equipmentLabel: `${typeName} · ${model} · SN ${serialNo}`,
    end: row.end!,
  }));
}
