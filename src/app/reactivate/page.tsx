"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ReactivatePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const { data: user, isLoading } = trpc.user.me.useQuery(undefined, {
    retry: false,
  });

  const reactivate = trpc.user.reactivate.useMutation({
    onSuccess: () => {
      // After reactivation, redirect to Gmail connect to restore email monitoring
      window.location.href = "/api/gmail/connect?returnTo=/events";
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // If the user is not deactivated, redirect them to the app
  if (user && user.accountStatus !== "DEACTIVATED") {
    router.replace("/events");
    return null;
  }

  const deactivatedDate = user?.deactivatedAt
    ? new Date(user.deactivatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "recently";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Account Deactivated</CardTitle>
          <CardDescription>
            Your account was deactivated on {deactivatedDate} due to inactivity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Email monitoring and briefs have been paused, but your data has not
            been deleted. Reactivating will restore your account and redirect you
            to reconnect your email.
          </p>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <Button
            onClick={() => reactivate.mutate()}
            disabled={reactivate.isPending}
            className="w-full"
          >
            {reactivate.isPending ? "Reactivating..." : "Reactivate My Account"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            After reactivation, you will need to reconnect your Gmail account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
