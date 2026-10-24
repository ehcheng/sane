"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[var(--agenda-surface)] p-6 shadow-lg focus:outline-none">
          <AlertDialog.Title className="text-agenda-title font-atkinson font-bold text-agenda-ink">
            Delete event?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-agenda-base font-atkinson text-agenda-ink-muted mt-2">
            &ldquo;{title}&rdquo; will be permanently removed.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-6">
            <AlertDialog.Cancel className="flex-1 h-[var(--agenda-touch-min)] rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent">
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className="flex-1 h-[var(--agenda-touch-min)] rounded-xl bg-agenda-danger font-inter font-medium text-agenda-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agenda-accent"
            >
              Delete
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
