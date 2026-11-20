import { loginSchema } from "@caro/shared";
import { useState, type SubmitEvent } from "react";
import { api, formErrorMessage } from "../lib/api";
import { fieldErrors } from "../lib/forms";
import { FormShell } from "./FormShell";
import { TextField } from "./TextField";

export function LoginForm() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      phone: String(form.get("phone") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error.issues));
      setFormError(undefined);
      return;
    }

    setSubmitting(true);
    const result = await api.login(parsed.data);
    setSubmitting(false);

    if (result.ok) {
      window.location.assign("/");
      return;
    }
    setFields(result.fields ?? {});
    setFormError(result.fields ? undefined : formErrorMessage(result));
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel="Ingresar"
      submitting={submitting}
      error={formError}
    >
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
        autoComplete="current-password"
        hint="¿La olvidaste? Escríbele a Caro y ella te ayuda a crear una nueva."
        required
        error={fields.password}
      />
    </FormShell>
  );
}
