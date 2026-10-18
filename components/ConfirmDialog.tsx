'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Charade's own confirmation dialog, in place of the browser's `confirm()`:
 * it matches the app, works the same in every browser, and is not suppressed
 * the way native dialogs can be inside in-app browsers or after repeated use.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Leave Reds?', confirmLabel: 'Leave team' })) …
 */
type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the red button and a warning icon. */
  danger?: boolean;
  icon?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is open answers the first with "no".
        setPending((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <Dialog options={pending} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function Dialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    document.addEventListener('keydown', onKey);
    // Keep the page behind from scrolling while the dialog is up.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const icon = options.icon ?? (options.danger ? '⚠️' : '🎭');
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <div
        className={`dialog${options.danger ? ' danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.message ? 'confirm-message' : undefined}
      >
        <div className="dialog-icon" aria-hidden="true">
          {icon}
        </div>
        <h2 id="confirm-title">{options.title}</h2>
        {options.message && (
          <p id="confirm-message" className="sub">
            {options.message}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => onClose(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            className={`btn ${options.danger ? 'danger-solid' : 'primary'}`}
            onClick={() => onClose(true)}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
