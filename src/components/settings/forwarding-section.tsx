"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FIELD_LIMITS } from "@/lib/validators";
import { toast } from "@/components/ui/use-toast";

export function ForwardingSection() {
  const { data: addresses } = trpc.forwarding.list.useQuery();
  const utils = trpc.useUtils();

  const createAddr = trpc.forwarding.create.useMutation({
    onSuccess: () => {
      utils.forwarding.list.invalidate();
      resetNew();
      toast({ title: "Address added", description: "Check your inbox for a verification link." });
    },
    onError: (err) => toast({ title: "Failed to add address", description: err.message, variant: "destructive" }),
  });
  const updateAddr = trpc.forwarding.update.useMutation({
    onSuccess: () => {
      utils.forwarding.list.invalidate();
      setEditingId(null);
      toast({ title: "Address updated" });
    },
    onError: (err) => toast({ title: "Failed to update address", description: err.message, variant: "destructive" }),
  });
  const deleteAddr = trpc.forwarding.delete.useMutation({
    onSuccess: (data) => {
      utils.forwarding.list.invalidate();
      if (data.monitoringPaused) {
        utils.user.me.invalidate();
        toast({ title: "Address deleted — monitoring paused", description: "No forwarding addresses remain. Add one to resume monitoring.", variant: "destructive" });
      } else {
        toast({ title: "Address deleted" });
      }
    },
    onError: (err) => toast({ title: "Failed to delete address", description: err.message, variant: "destructive" }),
  });
  const resendFwdVerify = trpc.forwarding.resendVerification.useMutation({
    onError: (err) => toast({ title: "Failed to resend verification", description: err.message, variant: "destructive" }),
  });
  const sendTest = trpc.forwarding.sendTestEmail.useMutation({
    onSuccess: (_data, variables) => {
      const addr = addresses?.find((a) => a.id === variables.id);
      toast({ title: `Test email sent to ${addr?.email ?? "address"}` });
    },
    onError: (err) => toast({ title: "Failed to send test email", description: err.message, variant: "destructive" }),
  });
  const [resendSentId, setResendSentId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editLabel, setEditLabel] = useState("");

  function resetNew() {
    setNewEmail("");
    setNewName("");
    setNewLabel("");
    setShowAdd(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    createAddr.mutate({
      email: newEmail.trim(),
      name: newName.trim() || null,
      label: newLabel.trim() || null,
    });
  }

  function startEdit(addr: {
    id: string;
    email: string;
    name: string | null;
    label: string | null;
  }) {
    setEditingId(addr.id);
    setEditEmail(addr.email);
    setEditName(addr.name ?? "");
    setEditLabel(addr.label ?? "");
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editEmail.trim()) return;
    updateAddr.mutate({
      id: editingId,
      email: editEmail.trim(),
      name: editName.trim() || null,
      label: editLabel.trim() || null,
    });
  }

  function toggleActive(addr: { id: string; isActive: boolean }) {
    updateAddr.mutate({ id: addr.id, isActive: !addr.isActive });
  }

  const isEmpty = addresses?.length === 0;

  return (
    <Card className={isEmpty ? "border-red-300 dark:border-red-800" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Forwarding Addresses</CardTitle>
            <CardDescription>
              Forwarded emails and digest summaries are sent to these addresses
            </CardDescription>
          </div>
          {!showAdd && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              Add address
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isEmpty && !showAdd && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Required — add at least one forwarding address to enable monitoring.
          </p>
        )}

        {addresses?.map((addr) =>
          editingId === addr.id ? (
            <form
              key={addr.id}
              onSubmit={handleUpdate}
              className="rounded-md border p-3 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    placeholder="Optional"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={FIELD_LIMITS.forwardingName}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Label</Label>
                  <Input
                    placeholder="Optional"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    maxLength={FIELD_LIMITS.forwardingLabel}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={updateAddr.isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div
              key={addr.id}
              className="rounded-md border p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-all">
                    {addr.name
                      ? `${addr.name} <${addr.email}>`
                      : addr.email}
                  </p>
                  {addr.label && (
                    <p className="text-xs text-muted-foreground">
                      {addr.label}
                    </p>
                  )}
                  {!addr.verifiedAt && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-xs text-amber-600">Pending verification</span>
                      {addr.ownedByMe !== false && (
                        resendSentId === addr.id ? (
                          <span className="text-xs text-muted-foreground">Sent!</span>
                        ) : (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => {
                              resendFwdVerify.mutate({ id: addr.id }, {
                                onSuccess: () => setResendSentId(addr.id),
                              });
                            }}
                            disabled={resendFwdVerify.isPending}
                          >
                            Resend
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </div>
                {addr.verifiedAt ? (
                  <Badge variant={addr.isActive ? "default" : "secondary"} className="shrink-0">
                    {addr.isActive ? "Active" : "Paused"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0">Unverified</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {addr.ownedByMe !== false && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => sendTest.mutate({ id: addr.id })}
                    disabled={sendTest.isPending && sendTest.variables?.id === addr.id}
                  >
                    {sendTest.isPending && sendTest.variables?.id === addr.id ? "Sending..." : "Send Test"}
                  </Button>
                )}
                {addr.ownedByMe !== false && addr.verifiedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(addr)}
                    disabled={updateAddr.isPending}
                  >
                    {addr.isActive ? "Pause" : "Activate"}
                  </Button>
                )}
                {addr.ownedByMe !== false && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(addr)}
                  >
                    Edit
                  </Button>
                )}
                {addr.ownedByMe !== false && <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={deleteAddr.isPending}
                    >
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete forwarding address?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Emails will no longer be forwarded to {addr.email}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAddr.mutate({ id: addr.id })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>}
              </div>
            </div>
          )
        )}

        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="rounded-md border border-dashed p-3 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="parent@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="Optional"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={FIELD_LIMITS.forwardingName}
                />
              </div>
              <div className="space-y-1">
                <Label>Label</Label>
                <Input
                  placeholder="Optional"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  maxLength={FIELD_LIMITS.forwardingLabel}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={createAddr.isPending}>
                {createAddr.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetNew}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
