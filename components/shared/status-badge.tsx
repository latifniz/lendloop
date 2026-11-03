import { Badge, type BadgeTone } from "@/components/ui/badge";

const TONES: Record<string, { tone: BadgeTone; label: string }> = {
  pending: { tone: "amber", label: "Pending" },
  approved: { tone: "green", label: "Approved" },
  declined: { tone: "red", label: "Declined" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  active: { tone: "blue", label: "Active" },
  overdue: { tone: "red", label: "Overdue" },
  returned: { tone: "green", label: "Returned" },
  available: { tone: "green", label: "Available" },
  unavailable: { tone: "neutral", label: "Unavailable" },
  removed: { tone: "neutral", label: "Removed" },
  processing: { tone: "blue", label: "Processing" },
  sent: { tone: "green", label: "Sent" },
  failed: { tone: "red", label: "Failed" },
  skipped: { tone: "neutral", label: "Skipped" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = TONES[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
