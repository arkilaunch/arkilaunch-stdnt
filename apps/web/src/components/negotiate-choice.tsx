import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import { useTenant } from '../lib/tenant.js';
import { Button, buttonClass, type ButtonVariant } from './button.js';
import { CopyButton } from './copy-button.js';
import { Modal } from './modal.js';
import { inAppNegotiation } from './negotiation-thread.js';

const SECONDS = 5;
type CopyState = 'pending' | 'copied' | 'failed';

// Shows what was copied, then opens Messenger in a new tab. A timer-fired window.open has no
// user gesture, so browsers may block it; then the button is the way through.
function MessengerHandoff({ url, message, copy, onClose }: { url: string; message: string; copy: CopyState; onClose: () => void }) {
  const [left, setLeft] = useState(SECONDS);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (copy !== 'copied' || blocked) return;
    if (left === 0) {
      // No 'noopener' feature: with it window.open always returns null and a block is undetectable.
      const tab = window.open(url, '_blank');
      if (tab) {
        tab.opener = null;
        onClose();
      } else setBlocked(true);
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [copy, left, blocked, url, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={copy === 'failed' ? 'Copy your billing details' : 'Billing details copied'}
      description={
        copy === 'failed'
          ? 'Copy the details below, then paste them into Messenger.'
          : 'Paste them into Messenger so the rental team has everything they need.'
      }
      size="sm"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={onClose} className={buttonClass('primary')}>
            Open Messenger now
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-md bg-surface-sunk p-3 font-sans text-sm text-text">{message}</pre>
          {copy === 'failed' && <CopyButton value={message} label="billing details" />}
        </div>
        <p className="text-sm text-text-muted" aria-live="polite">
          {blocked
            ? 'Your browser blocked the new tab. Tap Open Messenger now.'
            : copy === 'copied'
              ? `Opening Messenger in ${left}…`
              : null}
        </p>
      </div>
    </Modal>
  );
}

// message: null until the details have loaded. fallback: chat is off and the tenant has no Messenger link.
export function NegotiateChoice({
  onInApp,
  fallback,
  message,
  variant = 'primary',
  children = 'Negotiate via messenger',
}: {
  onInApp: () => void;
  fallback: () => void;
  message: string | null;
  variant?: ButtonVariant;
  children?: ReactNode;
}) {
  const messengerUrl = useTenant()?.messengerUrl ?? null;
  const inApp = inAppNegotiation();
  const [choosing, setChoosing] = useState(false);
  const [copy, setCopy] = useState<CopyState | null>(null);
  const closeHandOff = useCallback(() => setCopy(null), []);

  // Runs inside the click: the clipboard needs the user gesture.
  const handOff = () => {
    if (message === null) return;
    setChoosing(false);
    setCopy('pending');
    const done = (state: CopyState) => () => setCopy((s) => s && state);
    if (navigator.clipboard) void navigator.clipboard.writeText(message).then(done('copied'), done('failed'));
    else setCopy('failed');
  };

  const onClick = () => {
    if (!messengerUrl) return inApp ? onInApp() : fallback();
    return inApp ? setChoosing(true) : handOff();
  };

  return (
    <>
      <Button variant={variant} loading={Boolean(messengerUrl) && message === null} onClick={onClick}>
        {children}
      </Button>
      {messengerUrl && inApp && (
        <Modal open={choosing} onClose={() => setChoosing(false)} title="Where do you want to negotiate?" size="sm">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handOff}
              className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 text-left hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <MessageCircle aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">Facebook Messenger</span>
                <span className="text-xs text-text-muted">Copies your booking details and opens the rental company&rsquo;s Messenger.</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setChoosing(false);
                onInApp();
              }}
              className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 text-left hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <MessagesSquare aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">In-app chat</span>
                <span className="text-xs text-text-muted">
                  Stays on the booking, next to the price. Agreed prices are only binding once set here.
                </span>
              </span>
            </button>
          </div>
        </Modal>
      )}
      {messengerUrl && message !== null && copy && (
        <MessengerHandoff url={messengerUrl} message={message} copy={copy} onClose={closeHandOff} />
      )}
    </>
  );
}
