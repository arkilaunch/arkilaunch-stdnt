import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DamageAssessmentCreateSchema, DamageAssessmentResolveSchema, type BookingDetailResponse, type DamageAssessmentCreate } from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { bookingsQueries, usersQueries } from '../lib/queries.js';
import { formatDate, formatPeso } from '../lib/format.js';
import { Button } from './button.js';
import { Container } from './container.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Modal } from './modal.js';
import { useToast } from './toast.js';

interface Assessment {
  id: string; assignmentId: string; amount: string; status: string;
  notes: string; evidence: string; contractClause: string; invoiceId: string | null; reason: string | null;
}
interface Agreement { id: string; body: string; version: number | string; signedName: string; signedAt: string }
interface Response { assessments: Assessment[]; agreements: Agreement[] }
const textareaClass = 'w-full rounded-input border border-border bg-surface px-4 py-2.5 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring';

export function DamageAssessments({ booking }: { booking: BookingDetailResponse }) {
  const candidates = booking.items.filter((item) => item.status === 'completed' && (item.returnNeedsRepair || item.returnCondition === 'damaged'));
  const path = `/bookings/${booking.id}/damage-assessments`;
  const key = ['booking-damage-assessments', booking.id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => apiGet<Response>(path), enabled: candidates.length > 0 });
  const me = useQuery(usersQueries.me());
  const client = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [assignmentId, setAssignmentId] = useState('');
  const [agreementId, setAgreementId] = useState('');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [contractClause, setClause] = useState('');
  const [amount, setAmount] = useState('');
  const [customerAgreed, setCustomerAgreed] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);
  const [reason, setReason] = useState('');
  const [reviewError, setReviewError] = useState('');
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey }),
      client.invalidateQueries({ queryKey: ['statement', 'staff', booking.id] }),
      client.invalidateQueries({ queryKey: ['statement', 'me', booking.id] }),
      client.invalidateQueries({ queryKey: ['invoices'] }),
    ]);
  }
  const create = useMutation({
    mutationFn: (body: DamageAssessmentCreate) => apiPost(path, body),
    onSuccess: async () => { setOpen(false); await refresh(); toast.success('Damage assessment sent for Owner review'); },
    onError: (e) => setError(apiErrorText(e)),
  });
  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { decision: 'approved' | 'rejected'; reason: string } }) => apiPatch(`${path}/${id}`, body),
    onSuccess: async () => { setReview(null); await refresh(); toast.success('Assessment decision recorded'); },
    onError: (e) => setReviewError(apiErrorText(e)),
  });
  if (candidates.length === 0) return null;
  const agreement = query.data?.agreements.find((item) => item.id === agreementId);
  return <Container header={{ title: 'Damage assessment and contract review' }}>
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">A maintenance flag does not establish customer liability. Document the inspection, repair estimate, signed terms, and the customer’s agreement before asking the Owner to review a charge. Deposits are not deducted automatically.</p>
      {query.isPending && <p role="status">Loading assessments and signed agreements…</p>}
      {query.isError && <div role="alert"><p className="text-sm text-error">{apiErrorText(query.error)}</p><Button onClick={() => void query.refetch()}>Retry assessments</Button></div>}
      {query.data && <>
        {query.data.assessments.length === 0 && <p className="text-sm text-text-muted">No damage assessments recorded.</p>}
        {query.data.assessments.map((item) => <article key={item.id} className="flex flex-col gap-2 rounded-card border border-border p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{booking.items.find((unit) => unit.id === item.assignmentId)?.equipmentName ?? 'Equipment'}</h3><span className="capitalize">{item.status}</span></div>
          <p className="font-mono">Proposed charge: {formatPeso(Number(item.amount))}</p>
          <p className="whitespace-pre-wrap break-words"><strong>Inspection: </strong>{item.notes}</p>
          <p className="whitespace-pre-wrap break-words"><strong>Evidence and customer agreement: </strong>{item.evidence}</p>
          <details><summary className="cursor-pointer font-medium">Contract clause</summary><blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-primary pl-3">{item.contractClause}</blockquote></details>
          {item.reason && <p className="whitespace-pre-wrap break-words"><strong>Owner decision: </strong>{item.reason}</p>}
          {item.invoiceId && <p className="break-all">Damage invoice reference: <span className="font-mono">{item.invoiceId}</span></p>}
          {item.status === 'pending' && (me.data?.role === 'owner' ? <div className="flex flex-wrap gap-2">
            <Button variant="approve" onClick={() => { setReason(''); setReviewError(''); setReview({ id: item.id, decision: 'approved' }); }}>Review and approve</Button>
            <Button variant="secondary" onClick={() => { setReason(''); setReviewError(''); setReview({ id: item.id, decision: 'rejected' }); }}>Reject</Button>
          </div> : <p className="text-text-muted">Waiting for Owner review.</p>)}
        </article>)}
        {query.data.agreements.length > 0 ? <Button variant="secondary" onClick={() => {
          setAssignmentId(candidates[0]?.id ?? ''); setAgreementId(query.data.agreements[0]?.id ?? '');
          setNotes(''); setEvidence(''); setClause(''); setAmount(''); setCustomerAgreed(false); setError(''); setOpen(true);
        }}>Prepare damage assessment</Button> : <p className="text-sm text-text-muted">No signed agreement is available for this booking. Record maintenance and investigate contractual support before proposing a customer charge.</p>}
      </>}
    </div>
    <Modal open={open} onClose={() => setOpen(false)} closeDisabled={create.isPending} title="Prepare damage assessment" size="lg">
      <form className="flex flex-col gap-4" onSubmit={(e) => {
        e.preventDefault();
        const parsed = DamageAssessmentCreateSchema.safeParse({ assignmentId, agreementId, notes, evidence, contractClause, amount: Number(amount), customerAgreed });
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the assessment fields.'); return; }
        if (!agreement?.body.includes(parsed.data.contractClause)) { setError('Quote an exact clause from the selected signed agreement.'); return; }
        setError(''); create.mutate(parsed.data);
      }}>
        <Select label="Returned equipment" required value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>{candidates.map((unit) => <option key={unit.id} value={unit.id}>{unit.equipmentName ?? 'Equipment'}</option>)}</Select>
        <Select label="Signed agreement" required value={agreementId} onChange={(e) => { setAgreementId(e.target.value); setClause(''); }}>{query.data?.agreements.map((item) => <option key={item.id} value={item.id}>Version {item.version} · {item.signedName} · {formatDate(item.signedAt)}</option>)}</Select>
        {agreement && <section aria-label="Stored signed agreement" className="rounded-card border border-border bg-surface p-4"><h3 className="mb-2 font-semibold">Signed agreement snapshot</h3><div className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm" tabIndex={0}>{agreement.body}</div></section>}
        <label className="flex flex-col gap-2 text-sm font-medium">Exact contractual clause<textarea className={textareaClass} required minLength={10} maxLength={5000} rows={4} value={contractClause} onChange={(e) => setClause(e.target.value)} /></label>
        <label className="flex flex-col gap-2 text-sm font-medium">Inspection and proposed repair<textarea className={textareaClass} required minLength={3} maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="flex flex-col gap-2 text-sm font-medium">Evidence, estimate, and customer agreement details<textarea className={textareaClass} required minLength={3} maxLength={2000} rows={4} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
        <Input label="Proposed charge (PHP)" type="number" required min="0.01" max="100000000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={customerAgreed} onChange={(e) => setCustomerAgreed(e.target.checked)} />The customer agreed to the proposed charge; I recorded the supporting evidence above.</label>
        <p className="text-sm text-text-muted">Submitting requests Owner review. Approval creates a damage invoice due in seven days.</p>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={create.isPending} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={create.isPending}>Send for Owner review</Button></div>
      </form>
    </Modal>
    <Modal open={review !== null} onClose={() => setReview(null)} closeDisabled={resolve.isPending} title={review?.decision === 'approved' ? 'Approve damage invoice' : 'Reject damage assessment'}>
      <form className="flex flex-col gap-4" onSubmit={(e) => {
        e.preventDefault();
        if (!review) return;
        const parsed = DamageAssessmentResolveSchema.safeParse({ decision: review.decision, reason });
        if (!parsed.success) { setReviewError(parsed.error.issues[0]?.message ?? 'Enter a decision reason.'); return; }
        setReviewError(''); resolve.mutate({ id: review.id, body: parsed.data });
      }}>
        <p className="text-sm">{review?.decision === 'approved' ? 'Confirm the signed terms, evidence, customer agreement, and proposed amount support this charge. Approval creates one invoice due in seven days without deducting the deposit.' : 'Record why the proposed charge is not approved.'}</p>
        <label className="flex flex-col gap-2 text-sm font-medium">Decision reason<textarea className={textareaClass} required minLength={3} maxLength={1000} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {reviewError && <p role="alert" className="text-sm text-error">{reviewError}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={resolve.isPending} onClick={() => setReview(null)}>Cancel</Button><Button type="submit" variant={review?.decision === 'approved' ? 'approve' : 'primary'} loading={resolve.isPending}>{review?.decision === 'approved' ? 'Approve and create invoice' : 'Reject assessment'}</Button></div>
      </form>
    </Modal>
  </Container>;
}
