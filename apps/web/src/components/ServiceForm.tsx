import {
  serviceInputSchema,
  SERVICE_LIMITS,
  type AdminService,
  type ServiceData,
} from "@caro/shared";
import { useState, type SubmitEvent } from "react";
import { formErrorMessage, type ApiResult } from "../lib/api";
import { fieldErrors } from "../lib/forms";
import { FormShell } from "./FormShell";
import { TextField } from "./TextField";

interface Props {
  // Sin servicio es un alta; con servicio, una edición con sus datos precargados.
  service?: AdminService | undefined;
  save: (data: ServiceData) => Promise<ApiResult<{ service: AdminService }>>;
  onSaved: (service: AdminService) => void;
  onCancel: () => void;
}

// Caro puede escribir "25.000" o "$25000". Los puntos solo se quitan si son de miles
// ("1.500.000"); "25.5" queda como decimal y el esquema lo rechaza, en vez de guardar
// 255 sin avisar. Vacío no es 0.
function toNumber(value: FormDataEntryValue | null): number {
  const text = String(value ?? "").replace(/[$\s]/g, "");
  const digits = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll(".", "") : text;
  return digits === "" ? Number.NaN : Number(digits);
}

export function ServiceForm({ service, save, onSaved, onCancel }: Props) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    // Se valida en el navegador con el mismo esquema que usa la API.
    const parsed = serviceInputSchema.safeParse({
      name: String(form.get("name") ?? ""),
      priceCop: toNumber(form.get("priceCop")),
      durationMinutes: toNumber(form.get("durationMinutes")),
    });
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error.issues));
      setFormError(undefined);
      return;
    }

    setSubmitting(true);
    const result = await save(parsed.data);
    setSubmitting(false);

    if (result.ok) {
      onSaved(result.data.service);
    } else if (result.fields) {
      setFields(result.fields);
      setFormError(undefined);
    } else {
      setFields({});
      setFormError(formErrorMessage(result));
    }
  }

  const { durationMinutes } = SERVICE_LIMITS;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <h2 className="text-2xl">{service ? `Editar ${service.name}` : "Nuevo servicio"}</h2>
      <FormShell
        onSubmit={handleSubmit}
        submitLabel="Guardar"
        submitting={submitting}
        error={formError}
      >
        <TextField
          label="Nombre"
          name="name"
          defaultValue={service?.name}
          maxLength={SERVICE_LIMITS.name.max}
          required
          error={fields.name}
        />
        <TextField
          label="Precio (pesos)"
          name="priceCop"
          inputMode="numeric"
          placeholder="40000"
          defaultValue={service?.priceCop}
          required
          error={fields.priceCop}
        />
        <TextField
          label="Duración (minutos)"
          name="durationMinutes"
          inputMode="numeric"
          placeholder="60"
          hint={`De ${durationMinutes.min} a ${durationMinutes.max} minutos, en saltos de ${durationMinutes.step}.`}
          defaultValue={service?.durationMinutes}
          required
          error={fields.durationMinutes}
        />
      </FormShell>
      <button
        type="button"
        onClick={onCancel}
        className="h-12 rounded-xl border border-line text-base font-medium text-ink"
      >
        Cancelar
      </button>
    </div>
  );
}
