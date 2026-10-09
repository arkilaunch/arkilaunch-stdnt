import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';
import { blockLabel } from './app.inventory.js';

const UNIT = {
  id: '11111111-1111-4111-8111-111111111111', equipmentTypeId: '22222222-2222-4222-8222-222222222222', model: 'CAT 320D',
  serialNo: 'SN-320', availabilityStatus: 'available', runtimeHours: 0, modelNumber: null, yearOfManufacture: null,
  weightCapacityTons: null, engineType: null, fuelType: null, notes: null, categoryNote: null, photoUrl: null,
  equipmentTypeName: 'Excavator', optionGroups: [], photoCredit: null, photoSourceUrl: null,
  nextBlock: { startsAt: '2040-03-09T16:00:00.000Z', endsAt: '2040-03-12T16:00:00.000Z', notes: 'Engine overhaul' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('blockLabel', () => {
  it('shows the blocked Manila days, end exclusive, or "until" once started', () => {
    const block = { startsAt: '2040-03-09T16:00:00Z', endsAt: '2040-03-12T16:00:00Z' }; // Mar 10 to Mar 12, Manila
    expect(blockLabel(block, new Date('2040-01-01T00:00:00Z'))).toBe('Blocked Mar 10 – Mar 12');
    expect(blockLabel(block, new Date('2040-03-11T00:00:00Z'))).toBe('Blocked until Mar 12');
    expect(blockLabel({ startsAt: '2040-03-09T16:00:00Z', endsAt: '2040-03-10T16:00:00Z' }, new Date('2040-01-01'))).toBe('Blocked Mar 10');
  });
});

describe('Equipment blocked dates', () => {
  it('shows a unit its blocked chip and asks the API for blocked units', async () => {
    const fetcher = vi.fn((url: string) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (String(url).includes('/equipment?')) return json({ items: [UNIT], total: 1, categories: [] });
      return json([]);
    });
    vi.stubGlobal('fetch', fetcher);
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    await renderRoute('/app/inventory');

    expect(await screen.findByRole('button', { name: 'Blocked Mar 10 – Mar 12' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Blocked dates' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Blocked now or later' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([u]) => /\/equipment\?.*blockedFrom=\d{4}-\d{2}-\d{2}/.test(String(u)) && !String(u).includes('blockedTo'))).toBe(true),
    );
  });
});
