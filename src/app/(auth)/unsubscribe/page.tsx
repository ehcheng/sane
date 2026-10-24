"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<
    "loading" | "confirm" | "already" | "success" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("Missing unsubscribe token.");
      return;
    }

    fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.valid) {
          setStatus("error");
          setErrorMessage(
            data.error === "Invalid or expired token"
              ? "This unsubscribe link has expired or is invalid. Please contact the account holder to manage your forwarding preferences."
              : data.error || "Something went wrong."
          );
        } else if (data.alreadyUnsubscribed) {
          setStatus("already");
        } else {
          setStatus("confirm");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("Something went wrong. Please try again.");
      });
  }, [token]);

  async function handleUnsubscribe() {
    if (!token) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();

      if (data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Unsubscribe</CardTitle>
          <CardDescription>Validating your request...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Unable to Unsubscribe</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === "already" || status === "success") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Unsubscribed</CardTitle>
          <CardDescription>
            You&apos;ve been unsubscribed from individually forwarded school
            emails. The account holder can re-enable forwarding from their
            settings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Stop receiving forwarded school emails?</CardTitle>
        <CardDescription>
          You&apos;ll stop receiving individually forwarded school emails from
          this account. Daily and weekly briefs are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button
          onClick={handleUnsubscribe}
          disabled={submitting}
          variant="destructive"
        >
          {submitting ? "Unsubscribing..." : "Confirm Unsubscribe"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Suspense
        fallback={
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle>Unsubscribe</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
          </Card>
        }
      >
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
