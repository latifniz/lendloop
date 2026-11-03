"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, fieldIds } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { TOOL_CATEGORIES, TOOL_CONDITIONS, TOOL_LIMITS } from "@/lib/constants";
import { toolInputSchema, type ToolInput } from "@/lib/validation/schemas";

type FieldErrors = Partial<Record<keyof ToolInput, string>>;
type FormValues = { name: string; category: string; condition: string; description: string };

const EMPTY: FormValues = { name: "", category: "", condition: "", description: "" };

type ToolFormProps = {
  initialValues?: FormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: ToolInput) => Promise<void>;
  extra?: React.ReactNode;
};

export function ToolForm({ initialValues = EMPTY, submitLabel, pending, onSubmit, extra }: ToolFormProps) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = (key: keyof FormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    // Client-side validation is a convenience; Convex re-validates with the same schema.
    const parsed = toolInputSchema.safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ToolInput | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <Field id="tool-name" label="Tool name" error={errors.name}>
        <Input {...fieldIds("tool-name", errors.name)} value={values.name} onChange={set("name")} maxLength={TOOL_LIMITS.nameMax} placeholder="e.g. Cordless drill" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="tool-category" label="Category" error={errors.category}>
          <Select {...fieldIds("tool-category", errors.category)} value={values.category} onChange={set("category")}>
            <option value="">Choose a category</option>
            {TOOL_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Select>
        </Field>
        <Field id="tool-condition" label="Condition" error={errors.condition}>
          <Select {...fieldIds("tool-condition", errors.condition)} value={values.condition} onChange={set("condition")}>
            <option value="">Choose a condition</option>
            {TOOL_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>{condition}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        id="tool-description"
        label="Description"
        error={errors.description}
        hint={`${values.description.length}/${TOOL_LIMITS.descriptionMax}. Don't include phone numbers or addresses: listings are visible to all members.`}
      >
        <Textarea {...fieldIds("tool-description", errors.description, "hint")} value={values.description} onChange={set("description")} maxLength={TOOL_LIMITS.descriptionMax} placeholder="What is it, what's included, any tips for using it?" />
      </Field>
      {extra}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
