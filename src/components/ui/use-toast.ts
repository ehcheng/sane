"use client";

import { useState, useCallback, useEffect } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  duration?: number;
}

type ToastInput = Omit<Toast, "id">;

let globalAddToast: ((toast: ToastInput) => void) | null = null;

/**
 * Imperative toast function — can be called outside React components.
 */
export function toast(input: ToastInput) {
  if (globalAddToast) {
    globalAddToast(input);
  }
}

/**
 * Hook for the Toaster component to manage toast state.
 */
export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((input: ToastInput) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { ...input, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Register the global imperative function
  useEffect(() => {
    globalAddToast = addToast;
    return () => {
      globalAddToast = null;
    };
  }, [addToast]);

  return { toasts, addToast, dismissToast };
}
