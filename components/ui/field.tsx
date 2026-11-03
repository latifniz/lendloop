import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

/** Label + control + accessible error/hint wiring. Children must set id and aria-describedby from `fieldIds`. */
export function Field({ id, label, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function fieldIds(id: string, error?: string, hint?: string): { id: string; "aria-invalid": boolean; "aria-describedby"?: string } {
  return {
    id,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}
