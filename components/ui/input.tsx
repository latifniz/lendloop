import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

const fieldClasses =
  "w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-stone-400 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClasses, "min-h-24 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClasses, "h-10 pr-8", className)} {...props} />;
}
