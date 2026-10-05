import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPrompt } from './install-prompt.js';

function phone({ standalone = false } = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('display-mode') ? standalone : true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function offerInstall() {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  act(() => void window.dispatchEvent(event));
  return { prompt, event };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('InstallPrompt', () => {
  it("opens the browser's install sheet on Android", async () => {
    phone();
    render(<InstallPrompt appName="Almara" />);
    expect(screen.queryByRole('complementary', { name: 'Install the app' })).not.toBeInTheDocument();
    const { prompt, event } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('Add Almara to your home screen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add to home screen' }));
    expect(prompt).toHaveBeenCalled();
  });

  it('shows the Share steps on iOS, and "Not now" sticks', async () => {
    phone();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    const { unmount } = render(<InstallPrompt appName="Almara" />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('complementary', { name: 'Install the app' })).not.toBeInTheDocument();
    unmount();
    render(<InstallPrompt appName="Almara" />);
    expect(screen.queryByRole('complementary', { name: 'Install the app' })).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('stays hidden once installed or on desktop', () => {
    phone({ standalone: true });
    render(<InstallPrompt appName="Almara" />);
    offerInstall();
    expect(screen.queryByRole('complementary', { name: 'Install the app' })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    // jsdom without matchMedia is the desktop layout.
    render(<InstallPrompt appName="Almara" />);
    offerInstall();
    expect(screen.queryByText(/home screen/)).not.toBeInTheDocument();
  });
});
