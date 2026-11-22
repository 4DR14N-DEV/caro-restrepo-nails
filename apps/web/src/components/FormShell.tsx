import type { SubmitEvent, ReactNode } from "react";

interface FormShellProps {
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
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
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {children}
      <button
        type="submit"
        disabled={submitting}
        className="h-12 rounded-xl bg-primary hover:bg-primary-hover text-base font-medium text-on-primary disabled:opacity-60"
      >
        {submitting ? "Un momento…" : submitLabel}
      </button>
    </form>
  );
}
