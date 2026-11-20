interface Props {
  // Nombre del grupo para lectores de pantalla ("Días", "Horas").
  label: string;
  options: { value: string; label: string }[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}

// Botones grandes para elegir una sola opción (un día, una hora).
export function ChoiceGrid({ label, options, selected, onSelect }: Props) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={`h-12 rounded-xl border text-base font-medium ${
              active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
