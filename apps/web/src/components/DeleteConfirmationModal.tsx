import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface DeleteConfirmationModalProps {
  conversationTitle?: string;
  isDeleting: boolean;
  error?: string | null;
  onCancel: () => void;
  onDelete: () => void;
}

export default function DeleteConfirmationModal({
  conversationTitle,
  isDeleting,
  error,
  onCancel,
  onDelete,
}: DeleteConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();
    document.body.style.overflow = 'hidden';

    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
      document.body.style.overflow = '';
      previouslyFocused?.focus();
    };
  }, []);

  function requestClose() {
    if (isDeleting || isClosing) {
      return;
    }

    setIsClosing(true);
    closeTimer.current = window.setTimeout(onCancel, 150);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !isDeleting && !isClosing) {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled)',
    );
    if (!focusableElements?.length) {
      event.preventDefault();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm transition-opacity duration-150 ease-out animate-[modal-backdrop-in_150ms_ease-out] ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting && !isClosing) {
          requestClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-conversation-title"
        aria-describedby="delete-conversation-description"
        onKeyDown={handleKeyDown}
        className={`w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl transition-[opacity,transform] duration-150 ease-out animate-[modal-panel-in_180ms_ease-out] ${
          isClosing ? 'translate-y-2 scale-[0.98] opacity-0' : 'translate-y-0 scale-100 opacity-100'
        }`}
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-300">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-6 w-6"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" />
          </svg>
        </div>
        <h2 id="delete-conversation-title" className="text-xl font-semibold text-white">
          Delete conversation?
        </h2>
        <p id="delete-conversation-description" className="mt-2 text-sm leading-6 text-slate-300">
          Are you sure you want to delete this conversation? This action cannot be undone.
        </p>
        {conversationTitle && (
          <p className="mt-3 break-words rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200">
            “{conversationTitle}” will be deleted.
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={requestClose}
            disabled={isDeleting}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
