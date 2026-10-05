import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITIES, TICKET_STATUSES, TicketPatchSchema, type TicketPage, type TicketPatch, type TicketResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Button } from '../components/button.js';
import { Modal } from '../components/modal.js';
import { formatDate, formatStatus } from '../lib/format.js';

function TicketModal({ ticket, edit, close }: { ticket: TicketResponse; edit: boolean; close: () => void }) {
  const client = useQueryClient();
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [assignedTo, setAssignedTo] = useState(ticket.assignedTo ?? '');
  const agents = useQuery({ queryKey: ['support', 'agents'], queryFn: async () => {
    const all: { id: string; email: string; roleName: string; status: string }[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await apiGet<{ items: typeof all; total: number }>(`/users?limit=100&offset=${offset}`);
      all.push(...page.items);
      if (all.length >= page.total || page.items.length === 0) break;
    }
    return all.filter((user) => ['admin', 'owner'].includes(user.roleName) && user.status === 'active');
  }, enabled: edit });
  const patch = useMutation({ mutationFn: (body: TicketPatch) => apiPatch(`/tickets/${ticket.id}`, body), onSuccess: () => {
    void client.invalidateQueries({ queryKey: ['support'] }); close();
  } });
  function save(event: FormEvent) { event.preventDefault(); if (patch.isPending) return; patch.mutate(TicketPatchSchema.parse({ status, priority, assignedTo: assignedTo || null })); }
  return <Modal open onClose={close} title={`${edit ? 'Edit' : 'View'} #${ticket.code}`} closeDisabled={patch.isPending}>
    <div className="flex min-w-0 flex-col gap-4">
      <p className="break-words font-semibold">{ticket.subject}</p>
      <p className="text-sm text-text-muted">{TICKET_CATEGORY_LABELS[ticket.category]} · {formatDate(ticket.createdAt)}</p>
      <p className="whitespace-pre-wrap break-words text-base">{ticket.message}</p>
      {ticket.bookingId && <p className="break-all text-sm">Booking: {ticket.bookingId}</p>}
      {edit ? <form className="flex flex-col gap-4" onSubmit={save}>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as TicketResponse['status'])}>{TICKET_STATUSES.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</Select>
        <Select label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TicketResponse['priority'])}>{TICKET_PRIORITIES.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</Select>
        <Select label="Support agent" value={assignedTo} disabled={agents.isPending || agents.isError} onChange={(event) => setAssignedTo(event.target.value)}>
          <option value="">Unassigned</option>{agents.data?.map((agent) => <option key={agent.id} value={agent.id}>{agent.email}</option>)}
        </Select>
        {agents.isError && <p role="alert">{apiErrorText(agents.error)} <Button type="button" onClick={() => void agents.refetch()}>Retry agents</Button></p>}
        {patch.isError && <p role="alert" className="text-error">{apiErrorText(patch.error)}</p>}
        <Button variant="primary" type="submit" loading={patch.isPending} disabled={patch.isPending || agents.isError || agents.isPending}>Save changes</Button>
      </form> : <p>{formatStatus(ticket.status)} · {formatStatus(ticket.priority)} priority · {ticket.agentName ?? 'Unassigned'}</p>}
    </div>
  </Modal>;
}
export function TicketsPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{ ticket: TicketResponse; edit: boolean } | null>(null);
  const limit = 10;
  const tickets = useQuery({ queryKey: ['support', 'staff', search, status, offset], queryFn: () => apiGet<TicketPage>(`/tickets?${new URLSearchParams({ search, ...(status ? { status } : {}), limit: String(limit), offset: String(offset) })}`) });
  const resolve = useMutation({ mutationFn: (id: string) => apiPatch(`/tickets/${id}`, { status: 'resolved' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['support'] }) });
  const columns: TableColumn<TicketResponse>[] = [
    { header: 'Ticket ID', kind: 'text', cell: (ticket) => `#${ticket.code}` },
    { header: 'Issue type / Inquiry', kind: 'text', cell: (ticket) => <div className="break-words"><p className="font-semibold">{ticket.subject}</p><p className="text-sm text-text-muted">{TICKET_CATEGORY_LABELS[ticket.category]}</p></div> },
    { header: 'Priority', kind: 'text', cell: (ticket) => <span className={`rounded-xs px-2 py-1 text-sm ${ticket.priority === 'high' ? 'bg-error/10 text-error' : ticket.priority === 'medium' ? 'bg-warning/10 text-text' : 'bg-surface-sunk text-text'}`}>{formatStatus(ticket.priority)}</span> },
    { header: 'Status', kind: 'status', cell: (ticket) => <div><span>{formatStatus(ticket.status)}</span><progress aria-label={`Progress for ${ticket.code}`} max={100} value={ticket.status === 'open' ? 0 : ticket.status === 'in_progress' ? 50 : 100} className="mt-1 block h-2 w-24 max-w-full accent-[var(--color-primary)]" /></div> },
    { header: 'Support agent', kind: 'text', cell: (ticket) => <span className="break-all">{ticket.agentName ?? 'Unassigned'}</span> },
    { header: 'Actions', kind: 'action', cell: (ticket) => <div className="flex flex-wrap gap-2">
      <Button onClick={() => setSelected({ ticket, edit: false })}>View</Button>
      <Button onClick={() => setSelected({ ticket, edit: true })}>Edit</Button>
      <Button disabled={resolve.isPending || ticket.status === 'resolved'} onClick={() => resolve.mutate(ticket.id)}>Resolve</Button>
    </div> },
  ];
  const total = tickets.data?.total ?? 0;
  return <div className="flex min-w-0 flex-col gap-5">
    <PageHeader title="Ticket Management" description="Review customer requests and keep them informed." />
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Search by subject or ID" maxLength={120} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
      <Select label="Filter status" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="">All statuses</option>{TICKET_STATUSES.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</Select>
    </div>
    {tickets.isError && <p role="alert">{apiErrorText(tickets.error)} <Button onClick={() => void tickets.refetch()}>Retry</Button></p>}
    {resolve.isError && <p role="alert" className="text-error">{apiErrorText(resolve.error)}</p>}
    <Table columns={columns} rows={tickets.data?.items ?? []} rowKey={(ticket) => ticket.id} loading={tickets.isPending} empty="No tickets match your search." footer={<div className="flex flex-wrap items-center justify-between gap-3">
      <p>Showing {total ? offset + 1 : 0}-{Math.min(offset + limit, total)} of {total} tickets</p>
      <div className="flex gap-2"><Button disabled={offset === 0 || tickets.isFetching} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button><Button disabled={offset + limit >= total || tickets.isFetching} onClick={() => setOffset(offset + limit)}>Next</Button></div>
    </div>} />
    {selected && <TicketModal key={selected.ticket.id + String(selected.edit)} {...selected} close={() => setSelected(null)} />}
  </div>;
}
export const appTicketsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: '/app/tickets', beforeLoad: requireRole('admin', 'owner'), component: TicketsPage });
