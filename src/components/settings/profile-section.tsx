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
import { toast } from "@/components/ui/use-toast";

// ---------------------------------------------------------------------------
// Profile Section
// ---------------------------------------------------------------------------

export function ProfileSection() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      setEditing(false);
      toast({ title: "Profile updated" });
    },
    onError: (err) => toast({ title: "Failed to update profile", description: err.message, variant: "destructive" }),
  });
  const resendVerification = trpc.user.resendVerification.useMutation({
    onSuccess: () => {
      setVerifySent(true);
      toast({ title: "Verification email sent" });
    },
    onError: (err) => toast({ title: "Failed to send verification", description: err.message, variant: "destructive" }),
  });
  const reverifyEmail = trpc.user.reverifyEmail.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      setVerifySent(true);
      toast({ title: "Verification email sent" });
    },
    onError: (err) => toast({ title: "Failed to send verification", description: err.message, variant: "destructive" }),
  });
  const changeEmail = trpc.user.changeEmail.useMutation({
    onSuccess: (_data, variables) => {
      utils.user.me.invalidate();
      setShowEmailForm(false);
      setNewEmail("");
      setEmailPassword("");
      toast({ title: `Verification email sent to ${variables.newEmail}` });
    },
    onError: (err) => toast({ title: "Failed to change email", description: err.message, variant: "destructive" }),
  });
  const cancelEmailChange = trpc.user.cancelEmailChange.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Pending email change cancelled" });
    },
    onError: (err) => toast({ title: "Failed to cancel", description: err.message, variant: "destructive" }),
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [verifySent, setVerifySent] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  function startEditing() {
    setName(user?.name ?? "");
    setEditing(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    updateProfile.mutate({ name: name.trim() });
  }

  function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !emailPassword) return;
    changeEmail.mutate({ newEmail: newEmail.trim(), currentPassword: emailPassword });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-muted-foreground">Email</Label>
          <div className="flex items-center gap-2">
            <p className="text-sm">{user?.email}</p>
            {user?.emailVerified ? (
              <Badge variant="default" className="text-xs">Verified</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">Unverified</Badge>
            )}
          </div>
          {user?.pendingEmail && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Pending: {user.pendingEmail}
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-destructive"
                onClick={() => cancelEmailChange.mutate()}
                disabled={cancelEmailChange.isPending}
              >
                {cancelEmailChange.isPending ? "Cancelling..." : "Cancel"}
              </Button>
            </div>
          )}
          {!user?.emailVerified && (
            <div className="flex items-center gap-2 pt-1">
              {verifySent ? (
                <span className="text-xs text-muted-foreground">Verification email sent!</span>
              ) : (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => resendVerification.mutate()}
                  disabled={resendVerification.isPending}
                >
                  {resendVerification.isPending ? "Sending..." : "Resend verification email"}
                </Button>
              )}
            </div>
          )}
          {user?.emailVerified && !user?.pendingEmail && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground"
              onClick={() => {
                setVerifySent(false);
                reverifyEmail.mutate();
              }}
              disabled={reverifyEmail.isPending}
            >
              {reverifyEmail.isPending ? "Sending..." : "Reverify"}
            </Button>
          )}
          {!showEmailForm && !user?.pendingEmail && (
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEmailForm(true)}
              >
                Change Email
              </Button>
            </div>
          )}
          {showEmailForm && (
            <form onSubmit={handleEmailChange} className="space-y-3 pt-2">
              <div className="space-y-2">
                <Label htmlFor="new-email">New Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-change-password">Current Password</Label>
                <Input
                  id="email-change-password"
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={changeEmail.isPending || !newEmail.trim() || !emailPassword}>
                  {changeEmail.isPending ? "Sending..." : "Send Verification"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowEmailForm(false); setNewEmail(""); setEmailPassword(""); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Name</Label>
              <p className="text-sm">{user?.name}</p>
            </div>
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Password Section
// ---------------------------------------------------------------------------

export function PasswordSection() {
  const [showForm, setShowForm] = useState(false);
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowForm(false);
      toast({ title: "Password changed successfully" });
    },
    onError: (err) =>
      toast({
        title: "Failed to change password",
        description: err.message,
        variant: "destructive",
      }),
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 12;
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword &&
    !changePassword.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    changePassword.mutate({ currentPassword, newPassword, confirmPassword });
  }

  function handleCancel() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowForm(false);
  }

  if (!showForm) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change your account password</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              Change Password
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change your account password</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="At least 12 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={12}
              required
            />
            {passwordTooShort && (
              <p className="text-sm text-destructive">
                Password must be at least 12 characters
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm New Password</Label>
            <Input
              id="confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {passwordsMismatch && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {changePassword.isPending ? "Changing..." : "Change Password"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
