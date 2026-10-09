import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelpForm } from './account.help.js';
import { TicketsPage } from './app.tickets.js';

vi.mock('../components/page-header.js', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../lib/tenant.js', () => ({ useTenant: () => ({ contactEmail: 'support@example.test', messengerUrl: 'https://m.me/tenant' }) }));
afterEach(() => vi.unstubAllGlobals());
function wrapper(children: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
describe('help', () => {
  it('validates empty fields before sending and uses tenant direct channels', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(wrapper(<HelpForm />));
    await userEvent.click(screen.getByRole('button', { name: 'Submit ticket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Subject');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Email/ })).toHaveAttribute('href', 'mailto:support@example.test');
  });
  it('renders actual staff tickets with status and actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'one', code: 'ST-0001', subject: 'Payment help', category: 'payment', priority: 'medium', status: 'open', agentName: null }], total: 1 }), { status: 200 })));
    render(wrapper(<TicketsPage />));
    expect(await screen.findByText('#ST-0001')).toBeInTheDocument();
    expect(screen.getByText('Payment help')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });
});
