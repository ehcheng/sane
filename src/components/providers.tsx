"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import superjson from "superjson";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30s: avoid redundant refetches on page navigation
        retry: (failureCount: number, error: Error) => {
          // Don't retry deactivated account errors; redirect instead
          if (error instanceof TRPCClientError && error.message === "ACCOUNT_DEACTIVATED") {
            if (typeof window !== "undefined" && !window.location.pathname.startsWith("/reactivate")) {
              window.location.href = "/reactivate";
            }
            return false;
          }
          return failureCount < 3;
        },
      },
      mutations: {
        onError: (error: Error) => {
          if (error instanceof TRPCClientError && error.message === "ACCOUNT_DEACTIVATED") {
            if (typeof window !== "undefined" && !window.location.pathname.startsWith("/reactivate")) {
              window.location.href = "/reactivate";
            }
          }
        },
      },
    },
  }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </trpc.Provider>
      </ThemeProvider>
    </SessionProvider>
  );
}
