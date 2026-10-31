import { useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const nodes = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
      ),
    ].filter((node) => node.getClientRects().length > 0);
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <dialog
      ref={ref}
      onKeyDown={trapFocus}
      aria-label={title}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={`close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
