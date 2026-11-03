import { cn } from "@/lib/utils/cn";

type Props<Value extends string> = {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
};

export function FilterChips<Value extends string>({ label, options, value, onChange }: Props<Value>) {
  return (
    <div role="group" aria-label={label} className="mb-5 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            option.value === value ? "border-primary bg-primary text-white" : "border-border bg-white hover:bg-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
