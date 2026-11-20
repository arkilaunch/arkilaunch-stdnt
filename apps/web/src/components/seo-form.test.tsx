import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './toast.js';
import { SeoSection } from './seo-form.js';

// The map needs a real browser; its contract here is just "a labelled picker".
vi.mock('./pin-map.js', () => ({
  PinMap: ({ label }: { label: string }) => <span>{label}</span>,
}));

let patched: Record<string, unknown> | null = null;
const stored = {
  seoTitle: null,
  seoDescription: null,
  businessType: null,
  serviceAreas: ['Quezon City'],
  location: null,
  sameAs: [],
  publishHours: false,
  hours: { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6] },
};

beforeEach(() => {
  patched = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') patched = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(String(url)).toContain('/tenants/c0ffee/seo');
      return Promise.resolve(new Response(JSON.stringify({ ...stored, ...(patched ?? {}) })));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('SeoSection', () => {
  it("saves a platform admin's edits to that company's search settings", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <SeoSection basePath="/tenants/c0ffee" tenantName="Almara Construction" />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Mon–Sat, 07:00–17:00/)).toBeInTheDocument();
    expect(screen.getByText(/including crawlers that train AI models/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search title'), 'Almara | Equipment Rental QC');
    await user.type(screen.getByLabelText('Areas you serve'), 'Bulacan{Enter}');
    await user.type(screen.getByLabelText('Profile link 1'), 'https://www.linkedin.com/company/almara');
    await user.click(screen.getByLabelText(/Show business hours/));
    await user.click(screen.getByRole('button', { name: 'Save search settings' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toEqual({
      seoTitle: 'Almara | Equipment Rental QC',
      seoDescription: null,
      businessType: null,
      serviceAreas: ['Quezon City', 'Bulacan'],
      location: null,
      sameAs: ['https://www.linkedin.com/company/almara'],
      publishHours: true,
    });
    expect(screen.getByText('Almara | Equipment Rental QC')).toBeInTheDocument(); // snippet preview
  });
});
