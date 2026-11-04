"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import type { LoanRow } from "@/types";

/** Recent automation activity for a loan, e.g. "Reminder sent 2 days ago". */
export function reminderText(reminder: LoanRow["lastReminder"], now: number): string | null {
  if (!reminder) return null;
  switch (reminder.status) {
    case "sent":
      return `Reminder sent ${formatRelativeTime(reminder.at, now)}`;
    case "pending":
    case "processing":
      return "Reminder queued";
    case "failed":
      return "Reminder not delivered yet; it will be retried";
    default:
      return null;
  }
}

export function ReminderNote({ reminder }: { reminder: LoanRow["lastReminder"] }) {
  const [now] = useState(() => Date.now());
  const text = reminderText(reminder, now);
  if (!text) return null;
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
      <Bell className="size-4" aria-hidden />
      {text}
    </p>
  );
}
