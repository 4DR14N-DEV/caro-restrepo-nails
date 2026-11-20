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
        className="h-12 rounded-xl border border-neutral-300 px-4 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/20 aria-invalid:border-red-600"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
