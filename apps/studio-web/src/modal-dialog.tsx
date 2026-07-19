import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export const ModalDialog = ({
  children,
  className,
  initialFocusRef,
  labelledBy,
  onDismiss,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly labelledBy: string;
  readonly onDismiss: () => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    queueMicrotask(() => {
      (initialFocusRef?.current ?? firstFocusable(dialog) ?? dialog).focus();
    });
    return () => {
      if (dialog.open) dialog.close();
      const previous = previousFocusRef.current;
      queueMicrotask(() => previous?.focus());
    };
  }, [initialFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-labelledby={labelledBy}
      data-modal-dialog="true"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
};

const firstFocusable = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>(
    "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])",
  );
