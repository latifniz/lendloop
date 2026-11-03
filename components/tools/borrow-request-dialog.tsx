"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, fieldIds } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useSafeMutation } from "@/hooks/use-safe-mutation";
import { REQUEST_LIMITS } from "@/lib/constants";
import { DATE_RANGE_MESSAGES, parseIsoDay, validateDateRange } from "@/lib/utils/dates";
import { toDateInputValue } from "@/lib/utils/format";
import { requestInputSchema } from "@/lib/validation/schemas";

type Props = { toolId: Id<"tools">; toolName: string; trigger: ReactNode };
type Errors = { startDate?: string; endDate?: string; message?: string; form?: string };

export function BorrowRequestDialog({ toolId, toolName, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const { run, pending } = useSafeMutation(api.requests.create, { successMessage: "Request sent. The lender has been notified.", silent: true });
  const [today] = useState(() => toDateInputValue(Date.now()));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const start = parseIsoDay(startDate);
    const end = parseIsoDay(endDate);
    const next: Errors = {};
    if (start === null) next.startDate = "Choose a start date";
    if (end === null) next.endDate = "Choose an end date";
    if (start !== null && end !== null) {
      const problem = validateDateRange({ startDate: start, endDate: end }, Date.now());
      if (problem) next.endDate = DATE_RANGE_MESSAGES[problem];
      const parsed = requestInputSchema.safeParse({ startDate: start, endDate: end, message: message || undefined });
      if (!parsed.success && !problem) next.message = parsed.error.issues[0]?.message;
    }
    setErrors(next);
    if (start === null || end === null || Object.keys(next).length > 0) return;

    const outcome = await run({ toolId, startDate: start, endDate: end, message: message.trim() || undefined });
    if (outcome.ok) {
      setOpen(false);
      setStartDate("");
      setEndDate("");
      setMessage("");
    } else {
      setErrors({ form: outcome.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setErrors({}); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Borrow {toolName}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Pick the dates you need it. The lender will approve or decline.
        </DialogDescription>
        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="request-start" label="From" error={errors.startDate}>
              <Input type="date" min={today} {...fieldIds("request-start", errors.startDate)} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field id="request-end" label="Return by" error={errors.endDate} hint={`Up to ${REQUEST_LIMITS.maxLoanDays} days.`}>
              <Input type="date" min={startDate || today} {...fieldIds("request-end", errors.endDate, "hint")} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field id="request-message" label="Message (optional)" error={errors.message} hint={`${message.length}/${REQUEST_LIMITS.messageMax}`}>
            <Textarea {...fieldIds("request-message", errors.message, "hint")} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={REQUEST_LIMITS.messageMax} placeholder="What do you need it for?" />
          </Field>
          {errors.form ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errors.form}</p> : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send request"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
