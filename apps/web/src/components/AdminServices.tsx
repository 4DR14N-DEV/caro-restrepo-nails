import { formatDuration, formatPrice, type AdminService, type ServiceData } from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type ApiResult } from "../lib/api";
import { ServiceForm } from "./ServiceForm";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; services: AdminService[] };

// Qué formulario está abierto: ninguno, uno para crear o uno para editar un servicio.
type Editing = null | "new" | string;

const buttonClass = "h-12 rounded-xl border border-line px-4 text-base font-medium text-ink";

// Panel de Caro: ver, crear, editar, activar y desactivar servicios.
export function AdminServices() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [editing, setEditing] = useState<Editing>(null);
  const [toggleError, setToggleError] = useState<string>();

  // Sin sesión (venció) o sin permiso: ninguna acción del panel puede funcionar, así que
  // se muestra ese estado en vez de pedir que reintente.
  const lostAccess = useCallback((result: ApiResult<unknown>): boolean => {
    if (result.ok || (result.status !== 401 && result.status !== 403)) return false;
    setLoad({ state: result.status === 401 ? "signed-out" : "forbidden" });
    return true;
  }, []);

  const fetchServices = useCallback(async () => {
    setLoad({ state: "loading" });
    const result = await api.adminServices();
    if (result.ok) setLoad({ state: "ready", services: result.data.services });
    else if (!lostAccess(result))
      setLoad({
        state: "error",
        message:
          result.error === "network"
            ? "No pudimos cargar los servicios. Revisa tu internet e inténtalo de nuevo."
            : "No pudimos cargar los servicios. Inténtalo de nuevo en un momento.",
      });
  }, [lostAccess]);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  // Reemplaza un servicio en la lista, o lo agrega al final si es nuevo.
  function upsert(service: AdminService) {
    setLoad((current) => {
      if (current.state !== "ready") return current;
      const exists = current.services.some((item) => item.id === service.id);
      return {
        state: "ready",
        services: exists
          ? current.services.map((item) => (item.id === service.id ? service : item))
          : [...current.services, service],
      };
    });
  }

  async function toggleActive(service: AdminService) {
    setToggleError(undefined);
    const result = await api.updateService(service.id, { active: !service.active });
    if (result.ok) upsert(result.data.service);
    else if (!lostAccess(result))
      setToggleError(`No pudimos guardar el cambio de ${service.name}. Inténtalo de nuevo.`);
  }

  // Guardar desde el formulario: si se perdió el acceso, el panel cambia de estado.
  function guarded(save: (data: ServiceData) => Promise<ApiResult<{ service: AdminService }>>) {
    return async (data: ServiceData) => {
      const result = await save(data);
      lostAccess(result);
      return result;
    };
  }

  if (load.state === "loading") return <p className="text-muted">Cargando servicios…</p>;

  if (load.state === "signed-out") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Ingresa con la cuenta de Caro para administrar los servicios.</p>
        <a
          href="/ingreso"
          className="flex h-12 items-center rounded-xl bg-primary hover:bg-primary-hover px-6 text-base font-medium text-on-primary"
        >
          Ingresar
        </a>
      </div>
    );
  }

  if (load.state === "forbidden") return <p>Esta página es solo para Caro.</p>;

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-danger">
          {load.message}
        </p>
        <button type="button" onClick={() => void fetchServices()} className={buttonClass}>
          Reintentar
        </button>
      </div>
    );
  }

  const close = () => setEditing(null);
  const saved = (service: AdminService) => {
    upsert(service);
    close();
  };

  return (
    <div className="flex flex-col gap-4">
      {editing === "new" ? (
        <ServiceForm save={guarded(api.createService)} onSaved={saved} onCancel={close} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="h-12 rounded-xl bg-primary hover:bg-primary-hover text-base font-medium text-on-primary"
        >
          Agregar servicio
        </button>
      )}

      {toggleError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {toggleError}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {load.services.map((service) =>
          editing === service.id ? (
            <li key={service.id}>
              <ServiceForm
                service={service}
                save={guarded((data) => api.updateService(service.id, data))}
                onSaved={saved}
                onCancel={close}
              />
            </li>
          ) : (
            <li
              key={service.id}
              className={`flex flex-col gap-3 rounded-xl border border-line px-4 py-3 ${
                service.active ? "" : "bg-surface-alt text-muted"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">{service.name}</span>
                  <span className="text-sm">
                    {formatPrice(service.priceCop)} · {formatDuration(service.durationMinutes)}
                  </span>
                </div>
                {!service.active && (
                  <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-medium text-muted">
                    Inactivo
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(service.id)}
                  className={buttonClass}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void toggleActive(service)}
                  className={buttonClass}
                >
                  {service.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
