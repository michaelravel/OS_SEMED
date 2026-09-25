"use client";

import { useFormStatus } from "react-dom";

export function ActionSubmitButton({
  children,
  pendingLabel = "Salvando...",
  confirmMessage,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  confirmMessage?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage))
          event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
