"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

function VerifyResultContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const message = searchParams.get("message");
  const utils = trpc.useUtils();

  const isSuccess = status === "success";

  // Invalidate cached user/forwarding data so other pages show fresh state
  useEffect(() => {
    if (isSuccess) {
      utils.user.me.invalidate();
      utils.forwarding.list.invalidate();
    }
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 text-4xl">
            {isSuccess ? "\u2705" : "\u274C"}
          </div>
          <CardTitle className="text-xl">
            {isSuccess ? "Verified!" : "Verification Failed"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            {message ?? "Something went wrong."}
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Button asChild>
            <Link href="/events">Continue</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function VerifyResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center p-4">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <VerifyResultContent />
    </Suspense>
  );
}
