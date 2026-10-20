import { RETURN_CONDITIONS, needsMaintenance, type ReturnCondition } from '@arkilaunch/shared';
import { Select } from './select.js';
export function ReturnConditionFields({ id, condition, notes, onChange }: { id:string; condition:ReturnCondition | ''; notes:string; onChange:(condition:ReturnCondition | '',notes:string)=>void }) {
 return <div className="flex flex-col gap-3">
  <Select label="Equipment condition" required value={condition} onChange={(e)=>onChange(e.target.value as ReturnCondition,notes)}><option value="">Select condition</option>{Object.entries(RETURN_CONDITIONS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>
  <label htmlFor={`condition-${id}`} className="text-sm font-medium">Condition notes</label>
  <textarea id={`condition-${id}`} value={notes} maxLength={2000} rows={3} onChange={(e)=>onChange(condition,e.target.value)} className="w-full rounded-input border border-border bg-surface px-4 py-2.5 text-text" />
  {needsMaintenance(condition) && <p className="text-sm text-text-muted">Keep this unit unavailable. Inspect it and schedule {condition==='servicing'?'servicing':'repair'} from Inventory. Record the work before restoring availability.</p>}
  {condition==='damaged' && <p className="text-sm text-text-muted">Photograph the damage, obtain an estimate and review the signed agreement. Prepare a damage assessment below only when supported by the contract and agreed with the customer. Owner approval is required; no deposit deduction occurs automatically.</p>}
 </div>;
}
