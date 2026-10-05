import { createRoute } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SupportIdSchema } from '@arkilaunch/shared';
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TicketCreateSchema, type TicketCreate, type TicketResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { bookingsQueries } from '../lib/queries.js';
import { useTenant } from '../lib/tenant.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Button } from '../components/button.js';
import { formatDate, formatStatus } from '../lib/format.js';

export const ownTicketsQuery = () => ({ queryKey: ['support', 'mine'], queryFn: () => apiGet<TicketResponse[]>('/me/tickets') });

export function HelpForm({ bookingId }: { bookingId?: string }) {
  const tenant = useTenant();
  const client = useQueryClient();
  const [category, setCategory] = useState<TicketCreate['category']>(bookingId ? 'payment' : 'booking_equipment');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const create = useMutation({
    mutationFn: (body: TicketCreate) => apiPost<TicketResponse>('/me/tickets', body),
    onSuccess: () => { setSubject(''); setMessage(''); void client.invalidateQueries({ queryKey: ['support', 'mine'] }); },
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = TicketCreateSchema.safeParse({ category, subject, message, ...(bookingId ? { bookingId } : {}) });
    if (!parsed.success) { setError(parsed.error.issues.map((i) => `${formatStatus(String(i.path[0]))}: ${i.message}`).join('. ')); return; }
    setError(null);
    submitting.current = true;
    try { await create.mutateAsync(parsed.data); } catch { /* Mutation displays the safe API error. */ }
    finally { submitting.current = false; }
  }
  return <div className="grid min-w-0 gap-5 lg:grid-cols-[2fr_1fr]">
    <Surface className="min-w-0 p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">Submit Support Ticket</h2>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {bookingId && <p className="break-all text-sm text-text-muted">Booking attached: {bookingId}</p>}
        <Select label="Category" value={category} onChange={(event) => setCategory(event.target.value as TicketCreate['category'])}>
          {TICKET_CATEGORIES.map((value) => <option key={value} value={value}>{TICKET_CATEGORY_LABELS[value]}</option>)}
        </Select>
        <Input label="Subject" required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
        <label className="flex flex-col gap-1 text-sm font-medium">Message details
          <textarea required maxLength={4000} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} className="w-full resize-y rounded-input border border-border bg-surface p-3 text-base text-text focus-visible:outline-2 focus-visible:outline-focus-ring" />
        </label>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {create.isError && <p role="alert" className="text-sm text-error">{apiErrorText(create.error)}</p>}
        {create.isSuccess && <p role="status" className="text-sm text-success">Ticket #{create.data.code} submitted. Our team will review it.</p>}
        <Button type="submit" variant="primary" loading={create.isPending} disabled={create.isPending}>Submit ticket</Button>
      </form>
    </Surface>
    <Surface className="min-w-0 p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">Direct Channels</h2>
      <div className="flex flex-col gap-3">
        {tenant?.messengerUrl && <a className="flex min-h-11 items-center break-all text-accent underline" href={tenant.messengerUrl} target="_blank" rel="noopener noreferrer">Messenger</a>}
        {tenant?.contactEmail && <a className="flex min-h-11 items-center break-all text-accent underline" href={`mailto:${tenant.contactEmail}`}>Email: {tenant.contactEmail}</a>}
        {!tenant?.messengerUrl && !tenant?.contactEmail && <p className="text-sm text-text-muted">No direct channels have been configured. Submit a ticket to reach the team.</p>}
      </div>
    </Surface>
  </div>;
}

function AccountHelpPage() {
  const { booking } = accountHelpRoute.useSearch();
  const bookingQuery = useQuery({ ...bookingsQueries.detail(booking ?? ''), enabled: Boolean(booking), retry: false });
  const tickets = useQuery(ownTicketsQuery());
  // A malformed, missing or inaccessible booking never attaches an arbitrary ID.
  const attached = bookingQuery.data?.id;
  return <div className="flex min-w-0 flex-col gap-5">
    <PageHeader title="Help Center" description="Send a request to your rental team and track its status." />
    {booking && bookingQuery.isPending ? <p role="status">Checking booking...</p> : <HelpForm key={attached ?? 'no-booking'} {...(attached ? { bookingId: attached } : {})} />}
    {bookingQuery.isError && booking && <p className="text-sm text-text-muted">That booking could not be attached. You can still submit a ticket.</p>}
    <Surface className="min-w-0 p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">My tickets</h2>
      {tickets.isPending && <p role="status">Loading tickets...</p>}
      {tickets.isError && <p role="alert">{apiErrorText(tickets.error)} <Button onClick={() => void tickets.refetch()}>Retry</Button></p>}
      {tickets.data?.length === 0 && <p className="text-sm text-text-muted">No tickets yet.</p>}
      <ul className="flex flex-col gap-4">{tickets.data?.map((ticket) => <li key={ticket.id} className="min-w-0 border-b border-border pb-4 last:border-0">
        <p className="break-words font-semibold">#{ticket.code}: {ticket.subject}</p>
        <p className="text-sm text-text-muted">{formatStatus(ticket.status)} · {formatDate(ticket.createdAt)}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{ticket.message}</p>
      </li>)}</ul>
    </Surface>
  </div>;
}
export const accountHelpRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/help',
  validateSearch: (search: Record<string, unknown>): { booking?: string } => {
    const parsed = SupportIdSchema.safeParse(search.booking);
    return parsed.success ? { booking: parsed.data } : {};
  },
  component: AccountHelpPage,
});
