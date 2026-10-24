"use client";

import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { FIELD_LIMITS } from "@/lib/validators";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

export function ForwardingStep() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.user.me.useQuery();
  const { data: addresses = [], isLoading } = trpc.forwarding.list.useQuery();
  const createAddress = trpc.forwarding.create.useMutation({
    onSuccess: () => {
      utils.forwarding.list.invalidate();
      setEmail("");
      setName("");
      setLabel("");
      toast({ title: "Address added", description: "Check your inbox for a verification link." });
    },
    onError: (err) => toast({ title: "Failed to add address", description: err.message, variant: "destructive" }),
  });
  const updateAddress = trpc.forwarding.update.useMutation({
    onSuccess: () => {
      utils.forwarding.list.invalidate();
      toast({ title: "Address updated" });
    },
    onError: (err) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });
  const deleteAddress = trpc.forwarding.delete.useMutation({
    onSuccess: () => {
      utils.forwarding.list.invalidate();
      toast({ title: "Address removed" });
    },
    onError: (err) => toast({ title: "Failed to remove", description: err.message, variant: "destructive" }),
  });
  const resendVerification = trpc.forwarding.resendVerification.useMutation({
    onError: (err) => toast({ title: "Failed to resend", description: err.message, variant: "destructive" }),
  });
  const [resendSentId, setResendSentId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");

  // Auto-add user's login email if no addresses exist yet.
  // Ref prevents re-triggering if mutation completes before cache updates.
  const autoAddAttempted = useRef(false);
  useEffect(() => {
    if (!isLoading && addresses.length === 0 && user?.email && !autoAddAttempted.current) {
      autoAddAttempted.current = true;
      createAddress.mutate({ email: user.email, label: "Me" });
    }
  }, [isLoading, addresses.length, user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    createAddress.mutate({
      email: trimmedEmail,
      name: name.trim() || null,
      label: label.trim() || null,
    });
  }

  function toggleActive(id: string, currentlyActive: boolean) {
    updateAddress.mutate({ id, isActive: !currentlyActive });
  }

  const verifiedCount = addresses.filter(
    (a) => !!(a as { verifiedAt?: string | null }).verifiedAt
  ).length;
  const activeCount = addresses.filter(
    (a) => (a as { isActive?: boolean }).isActive !== false
  ).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    );
  }

  const isShared = user?.emailAccountType === "SHARED";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          {isShared ? "Brief Delivery Addresses" : "Forwarding Addresses"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isShared
            ? "Since you use a shared inbox, SANE won't forward individual emails (they're already in your Gmail). Instead, you'll receive daily and weekly brief digests. Add addresses for yourself, your partner, or anyone else who should receive them."
            : "Where should we send important emails? Add addresses for yourself, your partner, or anyone else who needs to stay informed. These addresses receive forwarded emails and digest summaries."}
        </p>
      </div>

      {addresses.length > 0 && (
        <div className="space-y-3">
          {addresses.map((address) => {
            const isActive =
              (address as { isActive?: boolean }).isActive !== false;
            return (
              <Card key={address.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    {(address as { verifiedAt?: string | null }).verifiedAt ? (
                      <button
                        type="button"
                        onClick={() => toggleActive(address.id, isActive)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background"
                        }`}
                        aria-label={
                          isActive ? "Deactivate address" : "Activate address"
                        }
                      >
                        {isActive && (
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={3}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4.5 12.75l6 6 9-13.5"
                            />
                          </svg>
                        )}
                      </button>
                    ) : (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-amber-300 bg-amber-50 text-amber-500">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            isActive ? "font-medium" : "text-muted-foreground"
                          }
                        >
                          {address.name
                            ? `${address.name} <${address.email}>`
                            : address.email}
                        </span>
                        {address.label && (
                          <Badge variant="secondary" className="text-xs">
                            {address.label}
                          </Badge>
                        )}
                        {(address as { verifiedAt?: string | null }).verifiedAt ? (
                          <Badge variant="default" className="text-xs">Verified</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Unverified</Badge>
                        )}
                      </div>
                      {!(address as { verifiedAt?: string | null }).verifiedAt && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="text-xs text-amber-600">
                            Check inbox to verify
                          </span>
                          {resendSentId === address.id ? (
                            <span className="text-xs text-muted-foreground">Sent!</span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              onClick={() => {
                                resendVerification.mutate({ id: address.id }, {
                                  onSuccess: () => setResendSentId(address.id),
                                });
                              }}
                              disabled={resendVerification.isPending}
                            >
                              Resend
                            </button>
                          )}
                        </div>
                      )}
                      {!isActive && (address as { verifiedAt?: string | null }).verifiedAt && (
                        <span className="text-xs text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteAddress.mutate({ id: address.id })}
                    disabled={deleteAddress.isPending}
                  >
                    Remove
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add an Address</CardTitle>
          <CardDescription>
            {isShared
              ? "Add an email address to receive brief digests."
              : "Add an email address to receive forwarded emails and summaries."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="fwd-name">Recipient Name</Label>
                <Input
                  id="fwd-name"
                  placeholder="e.g., Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={FIELD_LIMITS.forwardingName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fwd-email">Email *</Label>
                <Input
                  id="fwd-email"
                  type="email"
                  placeholder="parent@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fwd-label">Label</Label>
                <Input
                  id="fwd-label"
                  placeholder='e.g., "Mom", "Dad"'
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={FIELD_LIMITS.forwardingLabel}
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={!email.trim() || createAddress.isPending}
            >
              {createAddress.isPending ? "Adding..." : "Add Address"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {addresses.length > 0 && verifiedCount === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          {isShared
            ? "Verify at least one address to receive brief digests. You can also do this later from Settings."
            : "Verify at least one address to receive forwarded emails. You can also do this later from Settings."}
        </p>
      )}
    </div>
  );
}
