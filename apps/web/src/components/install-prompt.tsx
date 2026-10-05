import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { useMediaQuery } from '../lib/use-media-query.js';
import { Button } from './button.js';

// Chrome/Edge/Samsung fire this before showing their own mini-infobar; it is not in the DOM typings.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'arki:install-dismissed';
const remembered = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// QA 30: on a phone, offer "Add to home screen". Android gets the browser's own install sheet; iOS Safari has no API,
// so it gets the two taps to do by hand. Hidden once installed, on desktop, or after "Not now".
export function InstallPrompt({ appName, iconUrl }: { appName: string; iconUrl?: string | null }) {
  const phone = useMediaQuery('(max-width: 768px), (pointer: coarse)');
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(remembered);

  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const installed = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Private mode: it just comes back next visit.
    }
  };

  if (hidden || !phone || isStandalone() || (!event && !isIos())) return null;

  return (
    <aside
      aria-label="Install the app"
      className="fixed inset-x-3 bottom-3 z-50 flex items-start gap-3 rounded-md border border-border bg-surface p-4 shadow-lg"
    >
      <img src={iconUrl ?? '/icons/icon-192.png'} alt="" className="size-10 shrink-0 rounded-sm object-contain" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-semibold text-text">Add {appName} to your home screen</p>
        {event ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                void event.prompt();
                void event.userChoice.then(({ outcome }) => (outcome === 'accepted' ? setHidden(true) : dismiss()));
                setEvent(null);
              }}
            >
              Add to home screen
            </Button>
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Tap <Share aria-label="Share" className="inline size-4 align-text-bottom" /> Share, then{' '}
            <strong className="text-text">Add to Home Screen</strong>.
          </p>
        )}
      </div>
      {!event && (
        <button type="button" onClick={dismiss} aria-label="Not now" className="grid size-11 shrink-0 place-items-center rounded-sm text-text-muted">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </aside>
  );
}
