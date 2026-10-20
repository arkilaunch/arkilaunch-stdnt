import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { DamageAssessments } from './damage-assessments.js';
import { ToastProvider } from './toast.js';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api-client.js', async (original) => ({ ...await original<typeof import('../lib/api-client.js')>(), apiGet: api.get, apiPost: api.post, apiPatch: api.patch }));
const bookingId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '66666666-6666-4666-8666-666666666666';
const agreementId = '77777777-7777-4777-8777-777777777777';
const clause = 'Customer pays for documented negligent damage after agreeing to the repair estimate.';
const agreement = { id: agreementId, body: `Signed rental terms. ${clause} Normal wear is excluded.`, version: 'v1', signedName: 'QA Customer', signedAt: '2026-10-01T00:00:00Z' };
const pending = { id: 'assessment-1', assignmentId, amount: '1200.25', status: 'pending', notes: 'Cracked guard.', evidence: 'Photo and customer email.', contractClause: clause, invoiceId: null, reason: null };
const booking: BookingDetailResponse = {
  id: bookingId, code: 'EQR-2026-0001', status: 'completed', projectSiteId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333', siteCity: 'Pasig', siteProvince: null, trackerUrl: '/orders/x', siteContact: null, siteNotes: null,
  callRequestedAt: null, callConfirmedAt: null, createdAt: new Date(), quotation: null,
  deposit: { required: 5000, totalDeducted: 0, deductions: [] }, invoices: [], payments: [], changeRequests: [],
  items: [{ id: assignmentId, equipmentId: '44444444-4444-4444-8444-444444444444', equipmentName: 'Excavator',
    start: new Date(), end: new Date(), status: 'completed', returnCondition: 'damaged', returnConditionNotes: 'Cracked guard.', returnNeedsRepair: true }],
};
const clients: QueryClient[] = [];
function mount(role = 'admin', assessments: object[] = [], agreements: object[] = [agreement]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  api.get.mockImplementation((path: string) => Promise.resolve(path.includes('damage-assessments') ? { assessments, agreements } : { role }));
  render(<QueryClientProvider client={client}><ToastProvider><DamageAssessments booking={booking} /></ToastProvider></QueryClientProvider>);
  return client;
}
beforeEach(() => { api.get.mockReset(); api.post.mockReset(); api.patch.mockReset(); });
afterEach(() => { clients.forEach((client) => client.clear()); clients.length = 0; });

describe('Damage assessment review', () => {
  it('requires notes, evidence, a signed clause and customer agreement, and submits the proposed amount', async () => {
    api.post.mockResolvedValue({ ...pending });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Prepare damage assessment' }));
    const dialog = screen.getByRole('dialog', { name: 'Prepare damage assessment' });
    expect(within(dialog).getByLabelText('Stored signed agreement')).toHaveTextContent(agreement.body);
    const clauseField = within(dialog).getByLabelText('Exact contractual clause');
    const notes = within(dialog).getByLabelText('Inspection and proposed repair');
    const evidence = within(dialog).getByLabelText('Evidence, estimate, and customer agreement details');
    const consent = within(dialog).getByRole('checkbox');
    for (const field of [clauseField, notes, evidence, consent]) expect(field).toBeRequired();
    fireEvent.change(clauseField, { target: { value: 'Invented clause that the customer did not sign.' } });
    fireEvent.change(notes, { target: { value: 'Cracked guard; replacement estimate QA-42.' } });
    fireEvent.change(evidence, { target: { value: 'Photographs and customer email agreeing to estimate QA-42.' } });
    fireEvent.change(within(dialog).getByLabelText(/Proposed charge/), { target: { value: '1200.25' } });
    const form = clauseField.closest('form')!;
    fireEvent.submit(form);
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(consent);
    fireEvent.submit(form);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Quote an exact clause');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(clauseField, { target: { value: clause } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send for Owner review' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/bookings/${bookingId}/damage-assessments`, {
      assignmentId, agreementId, contractClause: clause, notes: 'Cracked guard; replacement estimate QA-42.',
      evidence: 'Photographs and customer email agreeing to estimate QA-42.', amount: 1200.25, customerAgreed: true,
    }));
  });

  it('keeps Owner decision controls hidden from administrators', async () => {
    mount('admin', [pending]);
    expect(await screen.findByText('Waiting for Owner review.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it.each(['approved', 'rejected'] as const)('records an Owner %s decision and refreshes booking balances', async (decision) => {
    api.patch.mockResolvedValue({ ...pending, status: decision });
    const client = mount('owner', [pending]);
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    await userEvent.click(await screen.findByRole('button', { name: decision === 'approved' ? 'Review and approve' : 'Reject' }));
    const dialog = screen.getByRole('dialog');
    const reason = within(dialog).getByLabelText('Decision reason');
    expect(reason).toBeRequired();
    fireEvent.submit(reason.closest('form')!);
    expect(api.patch).not.toHaveBeenCalled();
    await userEvent.type(reason, 'Evidence and signed terms reviewed.');
    await userEvent.click(within(dialog).getByRole('button', { name: decision === 'approved' ? 'Approve and create invoice' : 'Reject assessment' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/bookings/${bookingId}/damage-assessments/assessment-1`, { decision, reason: 'Evidence and signed terms reviewed.' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['statement', 'staff', bookingId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['statement', 'me', bookingId] });
  });

  it('shows readable query errors and retries without losing the booking context', async () => {
    mount();
    await screen.findByRole('button', { name: 'Prepare damage assessment' });
    api.get.mockImplementation((path: string) => path.includes('damage-assessments') ? Promise.reject(new Error('offline')) : Promise.resolve({ role: 'admin' }));
    const client = clients[0]!;
    await client.invalidateQueries({ queryKey: ['booking-damage-assessments', bookingId] });
    expect(await screen.findByRole('button', { name: 'Retry assessments' })).toBeInTheDocument();
    api.get.mockImplementation((path: string) => Promise.resolve(path.includes('damage-assessments') ? { assessments: [], agreements: [agreement] } : { role: 'admin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry assessments' }));
    expect(await screen.findByText('No damage assessments recorded.')).toBeInTheDocument();
  });

  it('blocks assessment preparation when the booking has no stored signed agreement', async () => {
    mount('admin', [], []);
    expect(await screen.findByText(/No signed agreement is available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare damage assessment' })).not.toBeInTheDocument();
  });
});
