"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";
import { User, Palette, KeyRound, Brain, Mail, Settings, Bug, RotateCcw, Power } from "lucide-react";
import { SettingsShell, type SettingsSection } from "@/components/settings/settings-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "grok", label: "Grok (xAI)" },
  { value: "gemini", label: "Google Gemini" },
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  grok: "Grok (xAI)",
  gemini: "Google Gemini",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4.1",
  anthropic: "claude-sonnet-4-5-20250929",
  grok: "grok-3",
  gemini: "gemini-3.8-flash",
};

type Provider = "openai" | "anthropic" | "grok" | "gemini";

function AdminEmailCard() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const changeEmail = trpc.user.changeEmail.useMutation({
    onSuccess: (_data, variables) => {
      utils.user.me.invalidate();
      setShowForm(false);
      setNewEmail("");
      setCurrentPassword("");
      toast({ title: `Verification email sent to ${variables.newEmail}` });
    },
    onError: (err) =>
      toast({
        title: "Failed to change email",
        description: err.message,
        variant: "destructive",
      }),
  });

  const cancelEmailChange = trpc.user.cancelEmailChange.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      toast({ title: "Pending email change cancelled" });
    },
    onError: (err) =>
      toast({
        title: "Failed to cancel",
        description: err.message,
        variant: "destructive",
      }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !currentPassword) return;
    changeEmail.mutate({ newEmail: newEmail.trim(), currentPassword });
  }

  function handleCancel() {
    setNewEmail("");
    setCurrentPassword("");
    setShowForm(false);
  }

  if (!showForm) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Admin Email</CardTitle>
              <CardDescription>
                {user?.email}
                {user?.pendingEmail && (
                  <span className="block text-amber-600 dark:text-amber-400 text-xs mt-1">
                    Pending: {user.pendingEmail}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 ml-2 text-xs text-destructive"
                      onClick={() => cancelEmailChange.mutate()}
                      disabled={cancelEmailChange.isPending}
                    >
                      {cancelEmailChange.isPending ? "Cancelling..." : "Cancel"}
                    </Button>
                  </span>
                )}
              </CardDescription>
            </div>
            {!user?.pendingEmail && (
              <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
                Change Email
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Email</CardTitle>
        <CardDescription>Change your admin account email address</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="admin-new-email">New Email</Label>
            <Input
              id="admin-new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-email-password">Current Password</Label>
            <Input
              id="admin-email-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={changeEmail.isPending || !newEmail.trim() || !currentPassword}>
              {changeEmail.isPending ? "Sending..." : "Send Verification"}
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

function AdminPasswordCard() {
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
              <CardTitle>Admin Password</CardTitle>
              <CardDescription>Change your admin account password</CardDescription>
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
        <CardTitle>Admin Password</CardTitle>
        <CardDescription>Change your admin account password</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="admin-current-password">Current Password</Label>
            <Input
              id="admin-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">New Password</Label>
            <Input
              id="admin-new-password"
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
            <Label htmlFor="admin-confirm-password">Confirm New Password</Label>
            <Input
              id="admin-confirm-password"
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

// ---------------------------------------------------------------------------
// AI Provider Configuration (extracted from inline default export)
// ---------------------------------------------------------------------------

function AIProviderCard() {
  const aiConfig = trpc.admin.aiConfig.useQuery();
  const utils = trpc.useUtils();

  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const saved = aiConfig.data;
  const savedProvider = (saved?.provider as Provider) ?? null;
  const savedModel = saved?.model ?? null;
  const savedVisionModel = saved?.visionModel ?? null;
  const hasKey = saved?.hasApiKey ?? false;

  useEffect(() => {
    if (saved) {
      if (saved.provider) setProvider(saved.provider as Provider);
      if (saved.model) {
        setModel(saved.model);
      } else {
        setModel(DEFAULT_MODELS[provider] ?? "");
      }
      setVisionModel(saved.visionModel ?? "");
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearFeedback = useCallback(() => {
    if (feedback) setFeedback(null);
  }, [feedback]);

  const isFirstTimeSetup = !hasKey && savedProvider === null;
  const providerChanged = savedProvider !== null && provider !== savedProvider;
  const modelChanged = savedModel !== null && model !== savedModel;
  const visionModelChanged = visionModel !== (savedVisionModel ?? "");
  const hasNewKey = apiKey.length > 0;
  const hasPendingChanges = isFirstTimeSetup ? hasNewKey : (providerChanged || modelChanged || visionModelChanged || hasNewKey);
  const needsKey = !hasKey || providerChanged;
  const keyConfigured = hasKey && !providerChanged;

  const canSave = useMemo(() => {
    if (!model) return false;
    if (!hasPendingChanges) return false;
    if (needsKey && !hasNewKey) return false;
    return true;
  }, [model, hasPendingChanges, needsKey, hasNewKey]);

  const setAIConfig = trpc.admin.setAIConfig.useMutation({
    onSuccess: () => {
      utils.admin.aiConfig.invalidate();
      setApiKey("");
      setFeedback({
        type: "success",
        message: "AI configuration saved successfully." +
          (visionModel ? ` Vision model: ${visionModel}` : ""),
      });
    },
    onError: (error) => {
      setFeedback({ type: "error", message: error.message });
    },
  });

  const clearAIConfig = trpc.admin.clearAIConfig.useMutation({
    onSuccess: () => {
      utils.admin.aiConfig.invalidate();
      setProvider("openai");
      setModel("");
      setVisionModel("");
      setApiKey("");
      setFeedback({
        type: "success",
        message: "AI config cleared. Configure a provider to resume email analysis.",
      });
    },
    onError: (error) => {
      setFeedback({ type: "error", message: error.message });
    },
  });

  function handleProviderChange(value: string) {
    clearFeedback();
    const p = value as Provider;
    setProvider(p);
    setApiKey("");
    const currentIsDefault = Object.values(DEFAULT_MODELS).includes(model);
    if (!model || currentIsDefault) {
      setModel(DEFAULT_MODELS[p] ?? "");
    }
  }

  function handleSave() {
    if (needsKey && !hasNewKey) {
      setFeedback({
        type: "error",
        message: providerChanged
          ? "A new API key is required when changing providers."
          : "An API key is required.",
      });
      return;
    }
    setAIConfig.mutate({
      provider,
      model,
      apiKey: hasNewKey ? apiKey : undefined,
      visionModel: visionModel.trim() || undefined,
    });
  }

  const testAIConfig = trpc.admin.testAIConfig.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        const response = data.text.length > 80 ? data.text.slice(0, 80) + "..." : data.text;
        setFeedback({
          type: "success",
          message: `Test passed: ${data.provider}/${data.model} responded "${response}" in ${data.latencyMs}ms (${data.tokensInput} in + ${data.tokensOutput} out tokens)`,
        });
      } else {
        const target = [data.provider, data.model].filter(Boolean).join("/") || "unknown";
        const status = data.httpStatus ? ` [HTTP ${data.httpStatus}]` : "";
        setFeedback({
          type: "error",
          message: `Test failed (${target})${status}: ${data.error}`,
        });
      }
    },
    onError: (error) => {
      setFeedback({ type: "error", message: `Test request failed: ${error.message}` });
    },
  });

  const isPending = setAIConfig.isPending || clearAIConfig.isPending || testAIConfig.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider Configuration</CardTitle>
        <CardDescription>
          Configure which AI provider and model to use for email analysis.
          An API key must be configured here before email analysis will work.
        </CardDescription>
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>Recommended:</strong> Google Gemini with gemini-3.8-flash.
          Gemini can analyze PDF attachments natively, preserving layout, tables,
          and images for better results with school flyers and newsletters. Other
          providers fall back to text extraction only.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {feedback && (
          <div
            className={`flex items-center justify-between rounded-md border p-3 text-sm ${
              feedback.type === "success"
                ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200"
                : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="ml-4 shrink-0 text-current opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        {saved && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              Current Configuration
              {hasKey ? (
                <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary">
                  Not configured
                </Badge>
              )}
            </div>
            {hasKey ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Provider</dt>
                <dd>{PROVIDER_LABELS[savedProvider!] ?? savedProvider}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono text-xs">{savedModel}</dd>
                {savedVisionModel && (
                  <>
                    <dt className="text-muted-foreground">Vision Model</dt>
                    <dd className="font-mono text-xs">{savedVisionModel}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">API Key</dt>
                <dd className="text-green-600 dark:text-green-400">Configured</dd>
                {saved.updatedAt && (
                  <>
                    <dt className="text-muted-foreground">Last Updated</dt>
                    <dd>
                      {new Date(saved.updatedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No AI provider configured. Select a provider and enter an API key below
                to enable email analysis.
              </p>
            )}
          </div>
        )}

        <Separator />

        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {hasKey ? "Update Configuration" : "Set Configuration"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {hasKey
              ? "Change the provider, model, or API key. Changing providers requires a new API key."
              : "Select a provider and enter your API key to start using a custom AI configuration."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger id="provider" className="w-full max-w-xs">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {providerChanged && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Changing provider requires entering a new API key.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            value={model}
            onChange={(e) => { clearFeedback(); setModel(e.target.value); }}
            placeholder={DEFAULT_MODELS[provider] ?? "e.g. gpt-4.1"}
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            The model identifier sent to the provider API (e.g. gpt-4.1,
            claude-sonnet-4-5-20250929, grok-3).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="visionModel">Vision Model (optional)</Label>
          <Input
            id="visionModel"
            value={visionModel}
            onChange={(e) => { clearFeedback(); setVisionModel(e.target.value); }}
            placeholder="e.g. gpt-4.1"
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            Used for emails with image attachments. Same API key as above.
            Leave blank to skip image analysis.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="apiKey">API Key</Label>
            {keyConfigured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Key saved
              </span>
            )}
            {needsKey && (
              <span className="text-xs font-normal text-red-500">
                Required
              </span>
            )}
          </div>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => { clearFeedback(); setApiKey(e.target.value); }}
            placeholder={
              keyConfigured
                ? "Leave blank to keep current key, or enter new key"
                : `Enter ${PROVIDER_LABELS[provider] ?? provider} API key`
            }
            className="max-w-md"
          />
          {keyConfigured && !hasNewKey && (
            <p className="text-xs text-muted-foreground">
              A key is already stored for {PROVIDER_LABELS[savedProvider!] ?? savedProvider}.
              You only need to enter a key here if you want to replace it.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={isPending || !canSave}>
            {setAIConfig.isPending ? "Saving..." : "Save Changes"}
          </Button>

          {hasKey && (
            <Button
              variant="outline"
              onClick={() => { clearFeedback(); testAIConfig.mutate(); }}
              disabled={isPending}
            >
              {testAIConfig.isPending ? "Testing..." : "Test"}
            </Button>
          )}

          {hasKey && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isPending}>
                  Reset to Defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset AI Configuration?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the stored API key and provider configuration.
                    Email analysis will stop until a new provider is configured.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearAIConfig.mutate()}>
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Token Cost Estimation
// ---------------------------------------------------------------------------

function TokenCostCard() {
  const config = trpc.admin.tokenCostConfig.useQuery();
  const utils = trpc.useUtils();
  const [inputCost, setInputCost] = useState("");
  const [outputCost, setOutputCost] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setInputCost(config.data.inputCostPerMillion != null ? String(config.data.inputCostPerMillion) : "");
      setOutputCost(config.data.outputCostPerMillion != null ? String(config.data.outputCostPerMillion) : "");
    }
  }, [config.data]);

  const save = trpc.admin.setTokenCostConfig.useMutation({
    onSuccess: () => {
      utils.admin.tokenCostConfig.invalidate();
      setFeedback({ type: "success", message: "Token cost configuration saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const parsedInput = parseFloat(inputCost);
  const parsedOutput = parseFloat(outputCost);
  const isValid = !isNaN(parsedInput) && parsedInput >= 0 && !isNaN(parsedOutput) && parsedOutput >= 0;
  const hasValues = inputCost.length > 0 && outputCost.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Cost Estimation</CardTitle>
        <CardDescription>
          Configure estimated costs per million tokens for the dashboard cost display.
          These are auto-populated when you change AI providers, but can be overridden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        {config.data?.inputCostPerMillion == null && config.data?.outputCostPerMillion == null && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Not configured. Save an AI provider in the card above to auto-populate default rates, or enter values manually.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="tokenCostInput">Input cost per 1M tokens (USD)</Label>
            <Input
              id="tokenCostInput"
              type="number"
              step="0.01"
              min={0}
              value={inputCost}
              onChange={(e) => { setFeedback(null); setInputCost(e.target.value); }}
              placeholder="e.g. 2.00"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tokenCostOutput">Output cost per 1M tokens (USD)</Label>
            <Input
              id="tokenCostOutput"
              type="number"
              step="0.01"
              min={0}
              value={outputCost}
              onChange={(e) => { setFeedback(null); setOutputCost(e.target.value); }}
              placeholder="e.g. 8.00"
              className="w-full"
            />
          </div>
        </div>
        <Button
          onClick={() => save.mutate({ inputCostPerMillion: parsedInput, outputCostPerMillion: parsedOutput })}
          disabled={!isValid || !hasValues || save.isPending}
          size="sm"
        >
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin Settings Page
// ---------------------------------------------------------------------------

const ADMIN_SECTIONS: SettingsSection[] = [
  { id: "system", label: "System", icon: Power },
  { id: "account", label: "Account", icon: User },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "access", label: "Access", icon: KeyRound },
  { id: "ai", label: "AI", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "worker", label: "Worker", icon: Settings },
  { id: "debug", label: "Debug", icon: Bug },
];

function AdminSectionContent({ section }: { section: string }) {
  switch (section) {
    case "system":
      return (
        <div className="space-y-6">
          <GlobalMonitoringCard />
          <LifecycleEnforcementCard />
          <DisplayFeaturesCard />
        </div>
      );
    case "account":
      return (
        <div className="space-y-6">
          <AdminEmailCard />
          <AdminPasswordCard />
        </div>
      );
    case "branding":
      return (
        <div className="space-y-6">
          <BrandingCard />
          <BroadcastCard />
          <AppUrlCard />
        </div>
      );
    case "access":
      return <SignupCodeCard />;
    case "ai":
      return (
        <div className="space-y-6">
          <AIProviderCard />
          <TokenCostCard />
          <PromptConfigCard />
        </div>
      );
    case "email":
      return (
        <div className="space-y-6">
          <ResendConfigCard />
          <EmailFooterCard />
        </div>
      );
    case "worker":
      return (
        <div className="space-y-6">
          <WorkerConfigCard />
          <DataRetentionCard />
          <RecentActivityLimitCard />
        </div>
      );
    case "debug":
      return <DebugConfigCard />;
    default:
      return null;
  }
}

export default function AdminSettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      description="Manage system configuration, AI providers, and email delivery."
      sections={ADMIN_SECTIONS}
      defaultSection="system"
    >
      {(activeSection) => <AdminSectionContent section={activeSection} />}
    </SettingsShell>
  );
}

// ---- System ----

function GlobalMonitoringCard() {
  const globalConfig = trpc.admin.globalConfig.useQuery();
  const utils = trpc.useUtils();

  const setGlobalMonitoring = trpc.admin.setGlobalMonitoring.useMutation({
    onMutate: async ({ enabled }) => {
      await utils.admin.globalConfig.cancel();
      const prev = utils.admin.globalConfig.getData();
      utils.admin.globalConfig.setData(undefined, (old) =>
        old ? { ...old, isMonitoringEnabled: enabled } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.admin.globalConfig.setData(undefined, ctx.prev);
      toast({
        title: "Failed to update monitoring",
        description: _err.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      utils.admin.globalConfig.invalidate();
    },
  });

  const isEnabled = globalConfig.data?.isMonitoringEnabled ?? true;

  return (
    <Card className={globalConfig.data && !isEnabled ? "border-red-500" : ""}>
      <CardHeader>
        <CardTitle>Global Monitoring</CardTitle>
        <CardDescription>
          Master switch for all email monitoring. When disabled, no emails are processed for any user.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="global-monitoring"
            checked={isEnabled}
            onCheckedChange={(checked) =>
              setGlobalMonitoring.mutate({ enabled: checked })
            }
            disabled={setGlobalMonitoring.isPending}
          />
          <Label htmlFor="global-monitoring" className="text-base font-medium">
            {isEnabled
              ? "Monitoring is active"
              : "Monitoring is disabled system-wide"}
          </Label>
        </div>
        {globalConfig.data?.updatedAt && (
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {new Date(globalConfig.data.updatedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LifecycleEnforcementCard() {
  const globalConfig = trpc.admin.globalConfig.useQuery();
  const utils = trpc.useUtils();

  const setLifecycle = trpc.admin.setLifecycleEnforcement.useMutation({
    onMutate: async ({ enabled }) => {
      await utils.admin.globalConfig.cancel();
      const prev = utils.admin.globalConfig.getData();
      utils.admin.globalConfig.setData(undefined, (old) =>
        old ? { ...old, lifecycleEnforcementEnabled: enabled } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.admin.globalConfig.setData(undefined, ctx.prev);
      toast({
        title: "Failed to update lifecycle enforcement",
        description: _err.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      utils.admin.globalConfig.invalidate();
    },
  });

  const isEnabled = globalConfig.data?.lifecycleEnforcementEnabled ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Lifecycle Enforcement</CardTitle>
        <CardDescription>
          When enabled, inactive users receive warnings and are eventually
          deactivated. Activity tracking and admin reporting always run
          regardless of this setting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="lifecycle-enforcement"
            checked={isEnabled}
            onCheckedChange={(checked) =>
              setLifecycle.mutate({ enabled: checked })
            }
            disabled={setLifecycle.isPending}
          />
          <Label htmlFor="lifecycle-enforcement" className="text-base font-medium">
            {isEnabled
              ? "Warnings and deactivation are active"
              : "Tracking only (no user-visible effects)"}
          </Label>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Users get 30 school days of inactivity before a warning, then 14
          calendar days with reminders at 14, 7, and 1 day before deactivation.
          Summer break (June 16 to Aug 14) pauses the inactivity clock.
        </p>
      </CardContent>
    </Card>
  );
}

// ---- Branding ----

function BrandingCard() {
  const config = trpc.admin.brandingConfig.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setName(config.data.brandName);
      setTagline(config.data.brandTagline);
    }
  }, [config.data]);

  const save = trpc.admin.setBrandingConfig.useMutation({
    onSuccess: () => {
      utils.admin.brandingConfig.invalidate();
      setFeedback({ type: "success", message: "Branding saved. Reload the page to see changes in the header." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Customize the app name and tagline shown in the UI, emails, and login pages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="space-y-2 max-w-md">
          <Label htmlFor="brandName">Short name</Label>
          <Input id="brandName" value={name} onChange={(e) => { setFeedback(null); setName(e.target.value); }} placeholder="SANE" className="w-full" />
          <p className="text-xs text-muted-foreground">Shown in the header, emails, and wherever the full name is too long.</p>
        </div>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="brandTagline">Tagline</Label>
          <Input id="brandTagline" value={tagline} onChange={(e) => { setFeedback(null); setTagline(e.target.value); }} placeholder="School Alerts, Notices & Essentials" className="w-full" />
          <p className="text-xs text-muted-foreground">Shown on the landing page and login screens.</p>
        </div>
        <Button onClick={() => save.mutate({ brandName: name, brandTagline: tagline })} disabled={!name || save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Broadcast Message ----

function BroadcastCard() {
  const config = trpc.admin.broadcastConfig.useQuery();
  const utils = trpc.useUtils();
  const [message, setMessage] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const isActive = config.data?.broadcastActive ?? false;
  const currentMessage = config.data?.broadcastMessage ?? null;
  const currentEndsAt = config.data?.broadcastEndsAt ?? null;
  const isExpired = currentEndsAt ? new Date(currentEndsAt) <= new Date() : false;

  const save = trpc.admin.setBroadcast.useMutation({
    onSuccess: () => {
      utils.admin.broadcastConfig.invalidate();
      setFeedback({ type: "success", message: "Broadcast message activated." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const clear = trpc.admin.clearBroadcast.useMutation({
    onSuccess: () => {
      utils.admin.broadcastConfig.invalidate();
      setMessage("");
      setEndsAt("");
      setFeedback({ type: "success", message: "Broadcast cleared." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!message.trim() || !endsAt) return;
    save.mutate({ message: message.trim(), endsAt: new Date(endsAt).toISOString() });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Broadcast Message</CardTitle>
            <CardDescription>
              Show a banner to all users until the specified end time.
            </CardDescription>
          </div>
          {isActive && !isExpired && (
            <Badge>Active</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}

        {isActive && !isExpired && currentMessage && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950">
            <p className="font-medium text-blue-900 dark:text-blue-100">Currently showing:</p>
            <p className="text-blue-800 dark:text-blue-200">{currentMessage}</p>
            {currentEndsAt && (
              <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                Expires: {new Date(currentEndsAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2 max-w-lg">
            <Label htmlFor="broadcast-msg">Message</Label>
            <Textarea
              id="broadcast-msg"
              value={message}
              onChange={(e) => { setFeedback(null); setMessage(e.target.value); }}
              placeholder="e.g. Scheduled maintenance tonight 10pm-12am ET"
              maxLength={500}
              rows={2}
            />
          </div>
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="broadcast-end">Show until</Label>
            <Input
              id="broadcast-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => { setFeedback(null); setEndsAt(e.target.value); }}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!message.trim() || !endsAt || save.isPending}>
              {save.isPending ? "Activating..." : "Activate"}
            </Button>
            {isActive && !isExpired && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
              >
                {clear.isPending ? "Clearing..." : "Clear Broadcast"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- App URL ----

function AppUrlCard() {
  const config = trpc.admin.appUrlConfig.useQuery();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const savedUrl = config.data?.appUrl ?? null;

  useEffect(() => {
    if (config.data) {
      setUrl(config.data.appUrl ?? "");
    }
  }, [config.data]);

  const save = trpc.admin.setAppUrlConfig.useMutation({
    onSuccess: () => {
      utils.admin.appUrlConfig.invalidate();
      setFeedback({ type: "success", message: "App URL saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const clear = trpc.admin.clearAppUrl.useMutation({
    onSuccess: () => {
      utils.admin.appUrlConfig.invalidate();
      setUrl("");
      setFeedback({ type: "success", message: "App URL reset to default." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const isDirty = url !== (savedUrl ?? "");
  const canSave = url.length > 0 && isDirty;
  const isPending = save.isPending || clear.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>App URL</CardTitle>
        <CardDescription>
          Public-facing URL used in email links and redirects. Leave blank to use the server&apos;s NEXTAUTH_URL environment variable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="space-y-2 max-w-md">
          <Label htmlFor="appUrl">URL</Label>
          <Input id="appUrl" value={url} onChange={(e) => { setFeedback(null); setUrl(e.target.value); }} placeholder="https://yourdomain.com" className="w-full" />
          {!savedUrl && (
            <p className="text-xs text-muted-foreground">(using NEXTAUTH_URL)</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate({ appUrl: url })} disabled={!canSave || isPending} size="sm">
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          {savedUrl && (
            <Button variant="outline" onClick={() => clear.mutate()} disabled={isPending} size="sm">
              {clear.isPending ? "Resetting..." : "Reset to default"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Signup Access Code ----

function SignupCodeCard() {
  const config = trpc.admin.signupCodeConfig.useQuery();
  const utils = trpc.useUtils();
  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setEnabled(config.data.enabled);
      setCode(config.data.code);
    }
  }, [config.data]);

  const save = trpc.admin.setSignupCodeConfig.useMutation({
    onSuccess: () => {
      utils.admin.signupCodeConfig.invalidate();
      setFeedback({ type: "success", message: "Signup code configuration saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const canSave = !enabled || code.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signup Access Code</CardTitle>
        <CardDescription>
          Gate new account creation behind an access code. When enabled, users must enter the correct code before they can sign up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label>Require access code</Label>
            <p className="text-xs text-muted-foreground">When enabled, new users must enter a code to create an account.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => { setFeedback(null); setEnabled(v); }} />
        </div>
        {enabled && (
          <div className="space-y-2 max-w-md">
            <Label htmlFor="signupCode">Access Code</Label>
            <Input
              id="signupCode"
              value={code}
              onChange={(e) => { setFeedback(null); setCode(e.target.value); }}
              placeholder="e.g. EARLYBIRD"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Share this code with users you want to grant access. Case-sensitive.
            </p>
          </div>
        )}
        <Button onClick={() => save.mutate({ enabled, code: code.trim() || undefined })} disabled={!canSave || save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DataRetentionCard() {
  const config = trpc.admin.retentionConfig.useQuery();
  const utils = trpc.useUtils();
  const [localDays, setLocalDays] = useState<string | null>(null);
  const [localEventDays, setLocalEventDays] = useState<string | null>(null);
  const [localSnapshotDays, setLocalSnapshotDays] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Derived display value: user edit > server value > default
  const days = localDays ?? String(config.data?.dataRetentionDays ?? 30);
  const eventDays = localEventDays ?? String(config.data?.eventRetentionDays ?? 90);
  const snapshotDays = localSnapshotDays ?? String(config.data?.feedbackSnapshotRetentionDays ?? 90);

  const saveMutation = trpc.admin.setRetentionConfig.useMutation({
    onSuccess: () => {
      utils.admin.retentionConfig.invalidate();
      setLocalDays(null);
      setLocalEventDays(null);
      setLocalSnapshotDays(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const currentValue = config.data?.dataRetentionDays ?? 30;
  const currentEventValue = config.data?.eventRetentionDays ?? 90;
  const currentSnapshotValue = config.data?.feedbackSnapshotRetentionDays ?? 90;
  const parsedDays = parseInt(days, 10);
  const parsedEventDays = parseInt(eventDays, 10);
  const parsedSnapshotDays = parseInt(snapshotDays, 10);
  const isValid = !isNaN(parsedDays) && parsedDays >= 7 && parsedDays <= 365
    && !isNaN(parsedEventDays) && parsedEventDays >= 7 && parsedEventDays <= 365
    && !isNaN(parsedSnapshotDays) && parsedSnapshotDays >= 7 && parsedSnapshotDays <= 365;
  const isDirty = isValid && (parsedDays !== currentValue || parsedEventDays !== currentEventValue || parsedSnapshotDays !== currentSnapshotValue);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Retention</CardTitle>
        <CardDescription>
          Processed email records older than this are rolled up into daily
          aggregate stats and deleted. The cleanup runs automatically once per day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="retentionDays">Email retention period (days)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="retentionDays"
              type="number"
              min={7}
              max={365}
              value={days}
              onChange={(e) => { setSaved(false); setLocalDays(e.target.value); }}
              className="w-24"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Range: 7–365. Default: 30. Minimum 7 days required for weekly brief users.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="eventRetentionDays">Event retention period (days)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="eventRetentionDays"
              type="number"
              min={7}
              max={365}
              value={eventDays}
              onChange={(e) => { setSaved(false); setLocalEventDays(e.target.value); }}
              className="w-24"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Range: 7–365. Default: 90. Events are pruned by event date (when they occurred), not extraction date.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="snapshotRetentionDays">Feedback snapshot retention (days)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="snapshotRetentionDays"
              type="number"
              min={7}
              max={365}
              value={snapshotDays}
              onChange={(e) => { setSaved(false); setLocalSnapshotDays(e.target.value); }}
              className="w-24"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Range: 7–365. Default: 90. Encrypted feedback snapshots older than this are permanently deleted.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => saveMutation.mutate({ dataRetentionDays: parsedDays, eventRetentionDays: parsedEventDays, feedbackSnapshotRetentionDays: parsedSnapshotDays })}
            disabled={!isDirty || saveMutation.isPending}
            size="sm"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivityLimitCard() {
  const globalConfig = trpc.admin.globalConfig.useQuery();
  const utils = trpc.useUtils();
  const [limit, setLimit] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (globalConfig.data) {
      setLimit(String(globalConfig.data.recentActivityLimit));
    }
  }, [globalConfig.data]);

  const setLimitMutation = trpc.admin.setRecentActivityLimit.useMutation({
    onSuccess: () => {
      utils.admin.globalConfig.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const currentValue = globalConfig.data?.recentActivityLimit ?? 50;
  const parsedLimit = parseInt(limit, 10);
  const isValid = !isNaN(parsedLimit) && parsedLimit >= 10 && parsedLimit <= 500;
  const isDirty = isValid && parsedLimit !== currentValue;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          Configure how many recent emails are shown on the user dashboard.
          Emails load in pages of 10 as the user scrolls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="activityLimit">Maximum emails to show</Label>
          <div className="flex items-center gap-3">
            <Input
              id="activityLimit"
              type="number"
              min={10}
              max={500}
              value={limit}
              onChange={(e) => { setSaved(false); setLimit(e.target.value); }}
              className="w-24"
            />
            <Button
              onClick={() => setLimitMutation.mutate({ limit: parsedLimit })}
              disabled={!isDirty || setLimitMutation.isPending}
              size="sm"
            >
              {setLimitMutation.isPending ? "Saving..." : "Save"}
            </Button>
            {saved && (
              <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Range: 10–500. Default: 50.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Resend / Email Forwarding ----

function ResendConfigCard() {
  const config = trpc.admin.resendConfig.useQuery();
  const utils = trpc.useUtils();
  const [fromAddress, setFromAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data?.fromAddress) setFromAddress(config.data.fromAddress);
  }, [config.data]);

  const save = trpc.admin.setResendConfig.useMutation({
    onSuccess: () => {
      utils.admin.resendConfig.invalidate();
      setApiKey("");
      setWebhookSecret("");
      setFeedback({ type: "success", message: "Resend configuration saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const [webhookEnabled, setWebhookEnabled] = useState(true);

  useEffect(() => {
    if (config.data?.webhookEnabled !== undefined) setWebhookEnabled(config.data.webhookEnabled);
  }, [config.data?.webhookEnabled]);

  const hasKey = config.data?.hasApiKey ?? false;
  const hasNewKey = apiKey.length > 0;
  const hasNewWebhookSecret = webhookSecret.length > 0;
  const webhookEnabledChanged = config.data?.webhookEnabled !== undefined && webhookEnabled !== config.data.webhookEnabled;
  const needsKey = !hasKey;
  const addressChanged = config.data?.fromAddress !== null && fromAddress !== (config.data?.fromAddress ?? "");
  const isFirstSetup = !hasKey && !config.data?.fromAddress;
  const canSave = fromAddress.length > 0 && (isFirstSetup ? hasNewKey : (addressChanged || hasNewKey || hasNewWebhookSecret || webhookEnabledChanged)) && (!needsKey || hasNewKey);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Forwarding (Resend)</CardTitle>
        <CardDescription>
          Configure the Resend API key and sender address for forwarding emails to parents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="resendFrom">From Address</Label>
          <Input id="resendFrom" value={fromAddress} onChange={(e) => { setFeedback(null); setFromAddress(e.target.value); }} placeholder="noreply@yourdomain.com" className="max-w-md" />
          <p className="text-xs text-muted-foreground">Must match a verified domain in your Resend account.</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="resendKey">API Key</Label>
            {hasKey && !hasNewKey && <span className="text-xs text-green-600 dark:text-green-400">Key saved</span>}
            {needsKey && <span className="text-xs text-red-500">Required</span>}
          </div>
          <Input id="resendKey" type="password" value={apiKey} onChange={(e) => { setFeedback(null); setApiKey(e.target.value); }} placeholder={hasKey ? "Leave blank to keep current key" : "Enter Resend API key"} className="max-w-md" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="webhookSecret">Webhook Signing Secret</Label>
            {config.data?.hasWebhookSecret && !hasNewWebhookSecret && <span className="text-xs text-green-600 dark:text-green-400">Configured</span>}
          </div>
          <Input id="webhookSecret" type="password" value={webhookSecret} onChange={(e) => { setFeedback(null); setWebhookSecret(e.target.value); }} placeholder={config.data?.hasWebhookSecret ? "Leave blank to keep current secret" : "Enter Resend webhook signing secret"} className="max-w-md" />
          <p className="text-xs text-muted-foreground">Optional. Found in Resend dashboard under Webhooks. Enables delivery tracking.</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="webhookEnabled" checked={webhookEnabled} onCheckedChange={(v) => { setFeedback(null); setWebhookEnabled(v); }} />
          <Label htmlFor="webhookEnabled" className="cursor-pointer">Webhook processing enabled</Label>
        </div>
        <Button onClick={() => save.mutate({ fromAddress, apiKey: hasNewKey ? apiKey : undefined, webhookSecret: hasNewWebhookSecret ? webhookSecret : undefined, webhookEnabled: webhookEnabledChanged ? webhookEnabled : undefined })} disabled={!canSave || save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Email Footer ----

function EmailFooterCard() {
  const config = trpc.admin.emailFooterConfig.useQuery();
  const utils = trpc.useUtils();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setEnabled(config.data.enabled);
      setText(config.data.text);
    }
  }, [config.data]);

  const save = trpc.admin.setEmailFooterConfig.useMutation({
    onSuccess: () => {
      utils.admin.emailFooterConfig.invalidate();
      setFeedback({ type: "success", message: "Email footer saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Footer</CardTitle>
        <CardDescription>
          Add an optional footer to every forwarded email, shown after the original message.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label>Include footer</Label>
            <p className="text-xs text-muted-foreground">When enabled, the text below is appended to every forwarded email.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => { setFeedback(null); setEnabled(v); }} />
        </div>
        <div className="space-y-2 max-w-lg">
          <Label htmlFor="footerText">Footer text</Label>
          <Textarea id="footerText" value={text} onChange={(e) => { setFeedback(null); setText(e.target.value); }} rows={3} placeholder="e.g. This email was filtered and summarized by AI. Review the original message below for full details." className="text-sm" />
        </div>
        <Button onClick={() => save.mutate({ enabled, text })} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Worker / Scheduler ----

function WorkerConfigCard() {
  const config = trpc.admin.workerConfig.useQuery();
  const utils = trpc.useUtils();
  const [poll, setPoll] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [tz, setTz] = useState("");
  const [briefEventDays, setBriefEventDays] = useState("");
  const [concurrency, setConcurrency] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setPoll(String(config.data.pollIntervalMinutes));
      setStart(String(config.data.activeHoursStart));
      setEnd(String(config.data.activeHoursEnd));
      setTz(config.data.timezone);
      setBriefEventDays(String(config.data.dailyBriefEventDays));
      setConcurrency(String(config.data.aiConcurrency));
    }
  }, [config.data]);

  const save = trpc.admin.setWorkerConfig.useMutation({
    onSuccess: () => {
      utils.admin.workerConfig.invalidate();
      setFeedback({ type: "success", message: "Worker configuration saved. Most changes take effect within 60 seconds. Poll interval changes require a worker restart." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  const pollNum = parseInt(poll, 10);
  const startNum = parseInt(start, 10);
  const endNum = parseInt(end, 10);
  const briefEventDaysNum = parseInt(briefEventDays, 10);
  const concurrencyNum = parseInt(concurrency, 10);
  const isValid = !isNaN(pollNum) && pollNum >= 1 && pollNum <= 1440 && !isNaN(startNum) && startNum >= 0 && startNum <= 23 && !isNaN(endNum) && endNum >= 1 && endNum <= 24 && tz.length > 0 && !isNaN(briefEventDaysNum) && briefEventDaysNum >= 1 && briefEventDaysNum <= 14 && !isNaN(concurrencyNum) && concurrencyNum >= 1 && concurrencyNum <= 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worker / Scheduler</CardTitle>
        <CardDescription>
          Configure how often the worker polls for new emails and during which hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="pollInterval">Poll interval (min)</Label>
            <Input id="pollInterval" type="number" min={1} max={1440} value={poll} onChange={(e) => { setFeedback(null); setPoll(e.target.value); }} className="w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activeStart">Active start (0-23)</Label>
            <Input id="activeStart" type="number" min={0} max={23} value={start} onChange={(e) => { setFeedback(null); setStart(e.target.value); }} className="w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="activeEnd">Active end (0-23)</Label>
            <Input id="activeEnd" type="number" min={1} max={24} value={end} onChange={(e) => { setFeedback(null); setEnd(e.target.value); }} className="w-full" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="timezone">Default timezone</Label>
            <Input id="timezone" value={tz} onChange={(e) => { setFeedback(null); setTz(e.target.value); }} placeholder="America/New_York" className="w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="briefEventDays">Daily brief event days</Label>
            <Input id="briefEventDays" type="number" min={1} max={14} value={briefEventDays} onChange={(e) => { setFeedback(null); setBriefEventDays(e.target.value); }} className="w-full" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="aiConcurrency">AI concurrency (1-10)</Label>
            <Input id="aiConcurrency" type="number" min={1} max={10} value={concurrency} onChange={(e) => { setFeedback(null); setConcurrency(e.target.value); }} className="w-full" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Active hours are applied per-user using each user&apos;s own timezone. The default timezone above is used as a fallback for users who haven&apos;t set one.
          Daily briefs include events for the next N days (configurable above).
          AI concurrency controls how many emails are analyzed in parallel per user. Higher values speed up backfills and polling but use more AI API quota.
        </p>
        <Button onClick={() => save.mutate({ pollIntervalMinutes: pollNum, activeHoursStart: startNum, activeHoursEnd: endNum, timezone: tz, dailyBriefEventDays: briefEventDaysNum, aiConcurrency: concurrencyNum })} disabled={!isValid || save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- AI Prompt Instructions ----

type PromptFieldKey =
  | "aiSystemInstruction"
  | "aiRelevanceInstruction"
  | "aiSummaryInstructionConcise"
  | "aiResponseFormatInstruction"
  | "aiNoSendInstruction"
  | "aiEventExtractionInstruction"
  | "aiBriefSummaryInstruction";

function PromptConfigCard() {
  const config = trpc.admin.promptConfig.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<Record<PromptFieldKey, string>>({
    aiSystemInstruction: "",
    aiRelevanceInstruction: "",
    aiSummaryInstructionConcise: "",
    aiResponseFormatInstruction: "",
    aiNoSendInstruction: "",
    aiEventExtractionInstruction: "",
    aiBriefSummaryInstruction: "",
  });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      const next: Record<PromptFieldKey, string> = {} as Record<PromptFieldKey, string>;
      for (const key of Object.keys(config.data.raw) as PromptFieldKey[]) {
        next[key] = config.data.raw[key] ?? "";
      }
      setForm(next);
    }
  }, [config.data]);

  const save = trpc.admin.setPromptConfig.useMutation({
    onSuccess: () => {
      utils.admin.promptConfig.invalidate();
      setFeedback({ type: "success", message: "Prompt instructions saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  function update(field: PromptFieldKey, value: string) {
    setFeedback(null);
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetField(field: PromptFieldKey) {
    setFeedback(null);
    setForm((f) => ({ ...f, [field]: "" }));
    // Immediately persist the reset — build a payload from current form with this field nulled
    const payload: Record<PromptFieldKey, string | null> = {} as Record<PromptFieldKey, string | null>;
    for (const k of Object.keys(form) as PromptFieldKey[]) {
      payload[k] = k === field ? null : (form[k] || null);
    }
    save.mutate(payload);
  }

  function saveAll() {
    const payload: Record<PromptFieldKey, string | null> = {} as Record<PromptFieldKey, string | null>;
    for (const k of Object.keys(form) as PromptFieldKey[]) {
      payload[k] = form[k] || null;
    }
    save.mutate(payload);
  }

  const fields: Array<{ key: PromptFieldKey; label: string }> = [
    { key: "aiSystemInstruction", label: "System Instruction" },
    { key: "aiRelevanceInstruction", label: "Relevance Instruction" },
    { key: "aiSummaryInstructionConcise", label: "Summary Instruction" },
    { key: "aiResponseFormatInstruction", label: "Response Format" },
    { key: "aiNoSendInstruction", label: "No-Send Instruction" },
    { key: "aiEventExtractionInstruction", label: "Event Extraction" },
    { key: "aiBriefSummaryInstruction", label: "Brief Summary" },
  ];

  const isCustomized = (key: PromptFieldKey) => form[key] !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Prompt Instructions</CardTitle>
        <CardDescription>
          Customize the prompts sent to the AI for email analysis. Changes apply to the next email processed.
          Empty fields use the factory default (shown as placeholder text).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        {fields.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor={key}>{label}</Label>
              {isCustomized(key) && (
                <>
                  <Badge variant="secondary" className="text-xs">Customized</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={() => resetField(key)}
                    disabled={save.isPending}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Reset
                  </Button>
                </>
              )}
            </div>
            <Textarea
              id={key}
              value={form[key]}
              placeholder={config.data?.defaults[key] ?? ""}
              onChange={(e) => update(key, e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
        ))}
        <Button onClick={saveAll} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save All Prompts"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Display Features ----

function DisplayFeaturesCard() {
  const config = trpc.admin.displayFeaturesConfig.useQuery();
  const utils = trpc.useUtils();

  const toggle = trpc.admin.setDisplayFeaturesConfig.useMutation({
    onMutate: async ({ showEmailSummaryInEvents }) => {
      await utils.admin.displayFeaturesConfig.cancel();
      const prev = utils.admin.displayFeaturesConfig.getData();
      utils.admin.displayFeaturesConfig.setData(undefined, { showEmailSummaryInEvents });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) utils.admin.displayFeaturesConfig.setData(undefined, context.prev);
      toast({ title: "Failed to save", variant: "destructive" });
    },
    onSettled: () => {
      utils.admin.displayFeaturesConfig.invalidate();
      utils.user.globalMonitoringStatus.invalidate();
    },
  });

  if (!config.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Features</CardTitle>
        <CardDescription>
          Control which features are visible to users.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label>Show Email Summary in Events</Label>
            <p className="text-xs text-muted-foreground">
              Display the AI-generated email summary bullet points in event detail views.
              When off, only the event title, details, and source email metadata are shown.
            </p>
          </div>
          <Switch
            checked={config.data.showEmailSummaryInEvents}
            onCheckedChange={(v) => toggle.mutate({ showEmailSummaryInEvents: v })}
            disabled={toggle.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Debug & Logging ----

function DebugConfigCard() {
  const config = trpc.admin.debugConfig.useQuery();
  const utils = trpc.useUtils();
  const [debugMode, setDebugMode] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [logDir, setLogDir] = useState("logs");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (config.data) {
      setDebugMode(config.data.debugMode);
      setShowDebug(config.data.showDebugUI);
      setLogDir(config.data.logDir);
    }
  }, [config.data]);

  const save = trpc.admin.setDebugConfig.useMutation({
    onSuccess: () => {
      utils.admin.debugConfig.invalidate();
      setFeedback({ type: "success", message: "Debug configuration saved." });
    },
    onError: (e) => setFeedback({ type: "error", message: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug & Logging</CardTitle>
        <CardDescription>
          Control debug logging and visibility of debug tools in the user interface.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className={`rounded-md border p-3 text-sm ${feedback.type === "success" ? "border-green-400 bg-green-100 text-green-900 dark:border-green-600 dark:bg-green-900/50 dark:text-green-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
            {feedback.message}
          </div>
        )}
        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label>Debug Mode</Label>
            <p className="text-xs text-muted-foreground">Enable verbose logging in the worker.</p>
          </div>
          <Switch checked={debugMode} onCheckedChange={(v) => { setFeedback(null); setDebugMode(v); }} />
        </div>
        <div className="flex items-center justify-between max-w-md">
          <div>
            <Label>Show Debug Tools</Label>
            <p className="text-xs text-muted-foreground">Show admin debug controls in the user UI (Check Now, force poll, prompt preview, reset tours, re-launch wizard, clear data).</p>
          </div>
          <Switch checked={showDebug} onCheckedChange={(v) => { setFeedback(null); setShowDebug(v); }} />
        </div>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="logDir">Log Directory</Label>
          <Input id="logDir" value={logDir} onChange={(e) => { setFeedback(null); setLogDir(e.target.value); }} className="w-full" />
        </div>
        <Button onClick={() => save.mutate({ debugMode, showDebugUI: showDebug, logDir })} disabled={save.isPending} size="sm">
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
