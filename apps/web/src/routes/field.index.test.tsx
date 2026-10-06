import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// A timekeeper must be able to open capture from /field (/app/ocr is staff-only).

const SITE = { id: 'site-1', name: 'Bonifacio Tower', code: 'BGC-1' };
const RENTAL = { id: 'rental-1', customerId: 'cust-1', projectSiteId: 'site-1' };
const EQUIPMENT = { id: 'eq-1', model: 'CAT 320D', serialNo: 'SN-1' };
const CUSTOMER = { id: 'cust-1', companyName: 'Almara Construction' };

function stubFetch({ rentals = [RENTAL], sites = [SITE] }: { rentals?: unknown[]; sites?: unknown[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/field/scan-targets')) {
        return json({ items: rentals.map(() => ({
          rentalId: 'rental-1', bookingCode: 'EQR-1', status: 'active', customerName: CUSTOMER.companyName, siteId: SITE.id,
          siteName: SITE.name, startDate: '2026-01-01T00:00:00.000Z', endDate: null,
          units: [{ equipmentId: EQUIPMENT.id, name: `Excavator · ${EQUIPMENT.model}`, serialNo: EQUIPMENT.serialNo, onSite: true }],
        })) });
      }
      if (u.includes('/reference/rentals')) return json(rentals);
      if (u.includes('/reference/equipment')) return json([EQUIPMENT]);
      if (u.includes('/reference/customers')) return json([CUSTOMER]);
      if (u.includes('/reference/project-sites')) return json(sites);
      if (u.includes('/sites')) return json({ items: sites, total: sites.length });
      if (u.includes('/edtr')) return json({ items: [], total: 0 });
      return json([]);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  setAccessToken(makeToken(makeValidClaims({ role: 'timekeeper' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Field dashboard: EDTR capture entry point', () => {
  it('offers the blank eDTR template for download', async () => {
    stubFetch();
    await renderRoute('/field');
    const group = await screen.findByRole('group', { name: 'Blank eDTR template' });
    expect(group).toHaveTextContent('PDF');
  });

  it('lets a timekeeper open the capture modal without visiting the staff console', async () => {
    stubFetch();
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  // The sheet goes through the edge-detecting scanner; jsdom has no camera, so its file-picker fallback shows.
  it('offers the sheet scanner, with the file picker as a fallback, once a paper sheet is chosen', async () => {
    stubFetch();
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    await waitFor(() => expect(record).toBeEnabled());
    await userEvent.click(record);

    await userEvent.click(await screen.findByRole('radio', { name: /photo of the paper sheet/i }));

    expect(await screen.findByRole('button', { name: 'Try camera again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });

  it('does not offer capture when no machine is on site, rather than opening an unusable form', async () => {
    stubFetch({ rentals: [] });
    await renderRoute('/field');

    const record = await screen.findByRole('button', { name: 'Record a field log' });
    expect(record).toBeDisabled();
    expect(await screen.findByText(/no machine is on site at your sites/i)).toBeInTheDocument();
  });
});
