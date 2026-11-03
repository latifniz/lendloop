"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type ConfirmDialogProps = {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => Promise<unknown> | void;
};

export function ConfirmDialog({ trigger, title, description, confirmLabel, destructive, pending, onConfirm }: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">{description}</DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <Button
            variant={destructive ? "danger" : "primary"}
            disabled={pending}
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
