import { sql } from 'drizzle-orm';
import { equipment, equipmentAssignments } from '@arkilaunch/db';

// On site now: delivered ('active'), or a legacy site-deployment unit left 'scheduled' but marked deployed, already
// started, and active on no other booking (the site hub's onSite rule, in SQL). Field-log scanning and the capture
// guard both use it, so the picker never offers a unit the server then refuses.
export const onSiteNow = sql`(${equipmentAssignments.status} = 'active' or (${equipmentAssignments.status} = 'scheduled' and ${equipment.availabilityStatus} = 'deployed' and ${equipmentAssignments.start} <= now() and not exists (select 1 from equipment_assignments other where other.equipment_id = ${equipmentAssignments.equipmentId} and other.status = 'active')))`;
