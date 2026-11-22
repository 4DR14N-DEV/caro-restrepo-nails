import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

// Campo de texto con etiqueta, ayuda y error asociados para lectores de pantalla.
export function TextField({ label, hint, error, ...input }: TextFieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5 text-left">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="h-12 rounded-xl border border-line px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 aria-invalid:border-danger text-ink bg-surface"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
