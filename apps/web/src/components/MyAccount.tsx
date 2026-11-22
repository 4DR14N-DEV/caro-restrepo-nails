import { changePasswordSchema, deleteAccountSchema } from "@caro/shared";
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

// Borrar la cuenta (RF22), confirmando con la contraseña en la misma página.
function DeleteAccountForm({ onCancel }: { onCancel: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function remove(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(undefined);
    const parsed = deleteAccountSchema.safeParse({ currentPassword });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);

    setBusy(true);
    const result = await api.deleteAccount(parsed.data);
    setBusy(false);
    // Ya no hay sesión: al inicio, con el aviso.
    if (result.ok) return window.location.replace("/?cuenta=borrada");
    if (result.status === 401) return window.location.replace(LOGIN_URL);
    if (result.fields?.currentPassword) return setError(result.fields.currentPassword);
    setProblem(formErrorMessage(result));
  }

  return (
    <form
      onSubmit={(event) => void remove(event)}
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-red-200 bg-red-50 p-4"
    >
      <p className="text-sm text-red-900">
        Se borran tu nombre y tu celular, y se cancelan tus citas próximas. Tus citas pasadas quedan
        sin tus datos. Esto no se puede deshacer.
      </p>
      <TextField
        label="Tu contraseña"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={error}
      />
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={busy}
          className="h-12 rounded-xl bg-red-700 px-4 text-base font-medium text-white disabled:opacity-60"
        >
          {busy ? "Borrando…" : "Borrar mi cuenta definitivamente"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-12 rounded-xl border border-neutral-300 bg-white px-4 text-base font-medium"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// Mi cuenta, al final de Mis citas: cambiar la contraseña y, para las clientas, borrar la
// cuenta (la de Caro no se borra).
export function MyAccount({ canDelete }: { canDelete: boolean }) {
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      {canDelete &&
        (deleting ? (
          <DeleteAccountForm onCancel={() => setDeleting(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="h-12 rounded-xl border border-red-300 px-6 text-base font-medium text-red-700"
          >
            Borrar mi cuenta
          </button>
        ))}
    </section>
  );
}
