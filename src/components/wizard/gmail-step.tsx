"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SenderPicker } from "./sender-picker";

const ACCOUNT_TYPE_OPTIONS = [
  {
    value: "DEDICATED" as const,
    title: "Dedicated school email",
    description:
      "I have a separate Gmail address that only receives school emails — like a .edu address, a school-provided Google account, or a Gmail I set up just for school.",
    info: "We'll monitor every email in this inbox. You can get individual forwards as they arrive, plus daily and weekly digest summaries.",
  },
  {
    value: "SHARED" as const,
    title: "Personal email (mixed inbox)",
    description:
      "School emails land in the same Gmail inbox as my personal email — for example, my regular @gmail.com address.",
    info: "After connecting your Gmail, you'll choose which email addresses are from your kids' school. Only those senders will be monitored — everything else stays private. You'll get daily and weekly digest summaries.",
  },
];

export function GmailStep() {
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const { data: user } = trpc.user.me.useQuery();
  const { data: connection, isLoading } =
    trpc.email.connectionStatus.useQuery();
  const disconnect = trpc.email.disconnect.useMutation({
    onSuccess: () => utils.email.connectionStatus.invalidate(),
  });

  const updateType = trpc.user.updateEmailAccountType.useMutation({
    onSuccess: () => {
      utils.user.me.invalidate();
      utils.user.getForwardingSettings.invalidate();
    },
  });

  const oauthSuccess = searchParams.get("success") === "true";
  const oauthError = searchParams.get("error");

  // Invalidate cached connection status when returning from OAuth redirect
  useEffect(() => {
    if (oauthSuccess) {
      utils.email.connectionStatus.invalidate();
    }
  }, [oauthSuccess, utils]);

  const isConnected = connection && connection.status === "ACTIVE";
  const needsReauth = connection && connection.status === "NEEDS_REAUTH";
  const selected = user?.emailAccountType ?? "DEDICATED";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Where Do Your School Emails Go?</h2>
        <p className="text-sm text-muted-foreground">
          We need to read your school emails so we can find what&apos;s important
          and send you summaries. First, tell us which kind of Gmail account your
          school emails arrive in, then connect it below.
        </p>
      </div>

      {/* Account type selection */}
      <div className="space-y-3">
        <p className="text-sm font-medium">
          Which best describes the Gmail account where your school emails go?
        </p>
        {ACCOUNT_TYPE_OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Card
              key={option.value}
              className={`cursor-pointer transition-colors ${
                isSelected
                  ? "border-primary ring-2 ring-primary/20"
                  : "hover:border-muted-foreground/30"
              }`}
              onClick={() => {
                if (!updateType.isPending) {
                  updateType.mutate({ emailAccountType: option.value });
                }
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {isSelected && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>
                  <CardTitle className="text-base">{option.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-4 pl-11">
                <CardDescription>{option.description}</CardDescription>
                {isSelected && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {option.info}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* OAuth alerts */}
      {oauthSuccess && !oauthError && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Gmail connected successfully!
        </div>
      )}

      {oauthError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          Connection failed: {oauthError}. Please try again.
        </div>
      )}

      {/* Gmail connection card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gmail Connection</CardTitle>
          <CardDescription>
            We need read-only access to your school Gmail to monitor for
            important emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                <svg
                  className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Connected
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {connection.emailAddress}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
              </Button>
              {selected === "SHARED" && <SenderPicker />}
            </div>
          ) : needsReauth ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
                <svg
                  className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    Re-authorization Required
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Your Gmail connection for {connection.emailAddress} needs to
                    be re-authorized.
                  </p>
                </div>
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                <p>Google will ask for permission again. Make sure to check the <strong>&quot;View your email&quot;</strong> box.</p>
              </div>
              <Button
                onClick={() => {
                  window.location.href = "/api/gmail/connect";
                }}
              >
                Reconnect Gmail
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 space-y-2">
                {selected === "DEDICATED" ? (
                  <>
                    <p className="font-medium">Sign in with your school Gmail account</p>
                    <p>
                      When you click Connect, sign in to the Gmail that only gets school
                      emails. For example, if your child attends Umbrella Academy,
                      you&apos;d connect <span className="font-medium">yourname@umbrellaacademy.edu</span> or
                      whichever Gmail you set up for school.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Sign in with your personal Gmail account</p>
                    <p>
                      When you click Connect, sign in to the regular Gmail where your
                      school emails arrive alongside your personal messages.
                      After connecting, we&apos;ll show you a list of recent senders
                      so you can pick which ones are school-related.
                    </p>
                  </>
                )}
              </div>
              <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <svg className="mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p>
                  Google will ask for permission to let this app <strong>view your
                  email</strong>. You must check that box — without it, we can&apos;t
                  read your school emails.
                </p>
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  window.location.href = "/api/gmail/connect";
                }}
              >
                <svg
                  className="mr-2 h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6ZM20 6L12 11L4 6H20ZM20 18H4V8L12 13L20 8V18Z"
                    fill="currentColor"
                  />
                </svg>
                Connect Gmail
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
