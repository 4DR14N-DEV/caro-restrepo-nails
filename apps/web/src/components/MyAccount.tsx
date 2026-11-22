import { changePasswordSchema } from "@caro/shared";
import { useState, type SubmitEvent } from "react";
import { api, formErrorMessage } from "../lib/api";
import { TextField } from "./TextField";

// Sin sesión se ingresa primero y después se vuelve a Mis citas.
const LOGIN_URL = `/ingreso?next=${encodeURIComponent("/mis-citas")}`;

const mismatchMessage = "Las contraseñas no coinciden.";

type Errors = Partial<Record<"currentPassword" | "newPassword" | "repeat", string>>;

// Cambiar la contraseña con la actual (S10). La sesión de este navegador sigue.
function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(undefined);
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Errors;
        found[field] ??= issue.message;
      }
    }
    if (repeat !== newPassword) found.repeat = mismatchMessage;
    setErrors(found);
    if (!parsed.success || found.repeat) return;

    setBusy(true);
    const result = await api.changePassword(parsed.data);
    setBusy(false);
    if (result.ok) return onDone();
    if (result.status === 401) return window.location.replace(LOGIN_URL);
    if (result.fields?.currentPassword || result.fields?.newPassword) {
      return setErrors({
        currentPassword: result.fields.currentPassword,
        newPassword: result.fields.newPassword,
      });
    }
    setProblem(formErrorMessage(result));
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <TextField
        label="Contraseña actual"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={errors.currentPassword}
      />
      <TextField
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        hint="Al menos 8 caracteres."
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={errors.newPassword}
      />
      <TextField
        label="Repite la contraseña nueva"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(event) => setRepeat(event.target.value)}
        error={errors.repeat}
      />
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="h-12 flex-1 rounded-xl bg-neutral-900 px-4 text-base font-medium text-white disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Guardar contraseña"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-12 rounded-xl border border-neutral-300 px-4 text-base font-medium"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// Mi cuenta, al final de Mis citas: cambiar la contraseña.
export function MyAccount() {
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <section aria-labelledby="mi-cuenta" className="flex flex-col gap-3">
      <h2 id="mi-cuenta" className="text-lg font-semibold">
        Mi cuenta
      </h2>
      {changed && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-900">
          Tu contraseña cambió. Cerramos tus otras sesiones abiertas.
        </p>
      )}
      {changing ? (
        <ChangePasswordForm
          onDone={() => {
            setChanging(false);
            setChanged(true);
          }}
          onCancel={() => setChanging(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setChanging(true);
            setChanged(false);
          }}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Cambiar contraseña
        </button>
      )}
    </section>
  );
}
