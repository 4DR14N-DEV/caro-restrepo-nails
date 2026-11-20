import type { FormEvent, ReactNode } from "react";

interface FormShellProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  submitting: boolean;
  error?: string | undefined;
  children: ReactNode;
}

// Estructura común de los formularios: error general arriba y botón grande abajo.
export function FormShell({ onSubmit, submitLabel, submitting, error, children }: FormShellProps) {
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {children}
      <button
        type="submit"
        disabled={submitting}
        className="h-12 rounded-xl bg-neutral-900 text-base font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Un momento…" : submitLabel}
      </button>
    </form>
  );
}
