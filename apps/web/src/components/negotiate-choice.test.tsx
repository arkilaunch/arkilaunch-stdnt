import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NegotiateChoice } from './negotiate-choice.js';

const tenant: { messengerUrl: string | null } = { messengerUrl: 'https://m.me/almaraconstructioncorp' };
vi.mock('../lib/tenant.js', () => ({ useTenant: () => tenant }));

const MESSAGE = 'Hi Almara! I would like to discuss the price.\nBooking: EQR-2026-0001';
let writeText: ReturnType<typeof vi.fn>;

function setup(props: Partial<Parameters<typeof NegotiateChoice>[0]> = {}) {
  const onInApp = vi.fn();
  const fallback = vi.fn();
  render(<NegotiateChoice message={MESSAGE} onInApp={onInApp} fallback={fallback} {...props}>Negotiate</NegotiateChoice>);
  return { onInApp, fallback };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
// One second per act: each countdown step is scheduled by the effect after the previous render.
const seconds = async (n: number) => {
  for (let i = 0; i < n; i++) await tick(1000);
};

beforeEach(() => {
  vi.useFakeTimers();
  tenant.messengerUrl = 'https://m.me/almaraconstructioncorp';
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('NegotiateChoice with in-app chat off', () => {
  it('copies the details, shows them, and opens Messenger in a new tab after 5 seconds', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    await tick(0);
    expect(writeText).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByRole('dialog', { name: 'Billing details copied' })).toHaveTextContent('Booking: EQR-2026-0001');
    expect(screen.getByText('Opening Messenger in 5…')).toBeInTheDocument();
    await seconds(4);
    expect(open).not.toHaveBeenCalled();
    await seconds(1);
    expect(open).toHaveBeenCalledWith('https://m.me/almaraconstructioncorp', '_blank');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the button in reach when the browser blocks the new tab', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    await tick(0);
    await seconds(5);
    expect(screen.getByText(/browser blocked the new tab/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Messenger now' })).toHaveAttribute('target', '_blank');
  });

  it('Cancel stops the redirect', async () => {
    const open = vi.spyOn(window, 'open');
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    await tick(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await seconds(10);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not redirect when the copy failed, so the details can be copied by hand', async () => {
    const open = vi.spyOn(window, 'open');
    writeText.mockReturnValue(Promise.reject(new Error('denied')));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    await seconds(10);
    expect(screen.getByRole('dialog', { name: 'Copy your billing details' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back when the tenant has no Messenger link', () => {
    tenant.messengerUrl = null;
    const { fallback, onInApp } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    expect(fallback).toHaveBeenCalled();
    expect(onInApp).not.toHaveBeenCalled();
  });

  it('waits for the details before it can hand off', () => {
    setup({ message: null });
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('NegotiateChoice with in-app chat on', () => {
  it('still offers the choice between Messenger and in-app chat', async () => {
    vi.stubEnv('VITE_ENABLE_IN_APP_NEGOTIATION', 'true');
    const { onInApp } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    expect(screen.getByRole('dialog', { name: 'Where do you want to negotiate?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /In-app chat/ }));
    expect(onInApp).toHaveBeenCalled();
  });
});
