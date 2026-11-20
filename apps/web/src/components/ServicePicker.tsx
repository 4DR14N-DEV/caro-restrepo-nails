import { formatDuration, formatPrice, type PublicService } from "@caro/shared";

interface Props {
  services: PublicService[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

// Lista de servicios para marcar uno o varios. Toda la fila es el área de toque.
export function ServicePicker({ services, selected, onToggle }: Props) {
  return (
    <ul className="flex flex-col gap-3">
      {services.map((service) => {
        const checked = selected.has(service.id);
        return (
          <li key={service.id}>
            <label
              className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-xl border px-4 py-3 ${
                checked ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(service.id)}
                className="size-5 shrink-0 accent-neutral-900"
              />
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{service.name}</span>
                <span className="text-sm text-neutral-600">
                  {formatPrice(service.priceCop)} · {formatDuration(service.durationMinutes)}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
