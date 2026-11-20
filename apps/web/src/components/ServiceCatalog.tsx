import { selectionSummary, summarize, type PublicService } from "@caro/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { ServicePicker } from "./ServicePicker";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; services: PublicService[] };

// Catálogo público: carga los servicios activos y suma los que la clienta marca.
// La selección todavía no se guarda; se usará al reservar.
export function ServiceCatalog() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const fetchServices = useCallback(async () => {
    setLoad({ state: "loading" });
    const result = await api.services();
    if (result.ok) {
      setLoad({ state: "ready", services: result.data.services });
    } else {
      setLoad({
        state: "error",
        message:
          result.error === "network"
            ? "No pudimos cargar los servicios. Revisa tu internet e inténtalo de nuevo."
            : "No pudimos cargar los servicios. Inténtalo de nuevo en un momento.",
      });
    }
  }, []);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  if (load.state === "loading") {
    return <p className="text-neutral-600">Cargando servicios…</p>;
  }

  if (load.state === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-red-700">
          {load.message}
        </p>
        <button
          type="button"
          onClick={() => void fetchServices()}
          className="h-12 rounded-xl border border-neutral-300 px-6 text-base font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (load.services.length === 0) {
    return <p className="text-neutral-600">Pronto publicaremos los servicios.</p>;
  }

  const chosen = summarize(load.services.filter((service) => selected.has(service.id)));

  return (
    <>
      <ServicePicker services={load.services} selected={selected} onToggle={toggle} />
      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white px-4 py-4">
        <p role="status" aria-live="polite" className="mx-auto max-w-md text-center font-medium">
          {chosen.count === 0
            ? "Elige uno o varios servicios para ver el total."
            : selectionSummary(chosen)}
        </p>
      </div>
    </>
  );
}
