"use client";

import { useEffect, useState } from "react";
import { useToastState, type Toast } from "./use-toast";

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  useEffect(() => {
    if (exiting) {
      const timer = setTimeout(() => onDismiss(toast.id), 150);
      return () => clearTimeout(timer);
    }
  }, [exiting, onDismiss, toast.id]);

  const isDestructive = toast.variant === "destructive";

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border shadow-xl ring-1 ring-black/5 ${
        exiting ? "animate-toast-slide-out" : "animate-toast-slide-in"
      } ${
        isDestructive
          ? "border-destructive/50 bg-destructive text-destructive-foreground"
          : "bg-zinc-50 text-zinc-900 border-l-4 border-l-primary border-zinc-200"
      }`}
      role="alert"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.description && (
            <p className={`mt-1 text-sm ${isDestructive ? "text-destructive-foreground/90" : "text-zinc-600"}`}>
              {toast.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExiting(true)}
          className={`shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 ${
            isDestructive ? "text-destructive-foreground" : "text-zinc-500 hover:text-zinc-700"
          }`}
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismissToast } = useToastState();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
