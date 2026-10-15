import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReturnCountdown } from './return-countdown.js';

let settings = { daysBefore: [5, 3, 1], overdue: true };

function mount(end: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReturnCountdown end={end} />
    </QueryClientProvider>,
  );
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeEach(() => {
  settings = { daysBefore: [5, 3, 1], overdue: true };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(settings), { status: 200 }))));
});
afterEach(() => vi.unstubAllGlobals());

describe('ReturnCountdown', () => {
  it('counts down inside the tenant window and flags overdue', async () => {
    mount(inDays(3));
    expect(await screen.findByText('Due in 3 days')).toBeInTheDocument();
  });

  it('shows overdue machines', async () => {
    mount(inDays(-2));
    expect(await screen.findByText('Overdue by 2 days')).toBeInTheDocument();
  });

  it('stays quiet outside the widest reminder point', async () => {
    settings = { daysBefore: [2], overdue: true };
    const { container } = mount(inDays(4));
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
