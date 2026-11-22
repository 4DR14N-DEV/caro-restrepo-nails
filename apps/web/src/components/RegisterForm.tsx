import { registerSchema } from "@caro/shared";
import { useState, type SubmitEvent } from "react";
import { api, formErrorMessage } from "../lib/api";
import { fieldErrors } from "../lib/forms";
import { nextPath } from "../lib/next";
import { FormShell } from "./FormShell";
import { TextField } from "./TextField";

export function RegisterForm() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      password: String(form.get("password") ?? ""),
      consent: form.get("consent") === "on",
    };

    // Se valida en el navegador con el mismo esquema que usa la API.
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error.issues));
      setFormError(undefined);
      return;
    }

    setSubmitting(true);
    const result = await api.register(parsed.data);
    setSubmitting(false);

    if (result.ok) {
      window.location.assign(nextPath(window.location.search));
      return;
    }
    if (result.error === "phone_taken") {
      setFields({ phone: "Ese celular ya tiene una cuenta. Ingresa con tu contraseña." });
      setFormError(undefined);
    } else if (result.fields) {
      setFields(result.fields);
      setFormError(undefined);
    } else {
      setFields({});
      setFormError(formErrorMessage(result));
    }
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel="Crear cuenta"
      submitting={submitting}
      error={formError}
    >
      <TextField label="Nombre" name="name" autoComplete="name" required error={fields.name} />
      <TextField
        label="Celular"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="300 123 4567"
        required
        error={fields.phone}
      />
      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="Mínimo 8 caracteres."
        required
        error={fields.password}
      />
      <div className="flex flex-col gap-1.5 text-left">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="consent"
            aria-invalid={fields.consent ? true : undefined}
            aria-describedby={fields.consent ? "consent-error" : undefined}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>
            Acepto la{" "}
            <a href="/politica-de-datos" target="_blank" className="font-medium underline">
              política de tratamiento de datos
            </a>
            .
          </span>
        </label>
        {fields.consent && (
          <p id="consent-error" className="text-sm text-danger">
            {fields.consent}
          </p>
        )}
      </div>
    </FormShell>
  );
}
