"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";
import type { ActivityFilterValues } from "./activity-filters";

function computeDateRange(preset: string) {
  if (preset === "all") return {};
  const days = preset === "7d" ? 7 : 30;
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { startDate: start.toISOString() };
}

export function CsvExportButton({ filters }: { filters: ActivityFilterValues }) {
  const dateRange = computeDateRange(filters.datePreset);

  const { refetch, isFetching } = trpc.activity.exportCsv.useQuery(
    {
      sender: filters.sender || undefined,
      keyword: filters.keyword || undefined,
      ...dateRange,
    },
    { enabled: false }
  );

  const handleExport = async () => {
    try {
      const { data } = await refetch();
      if (!data) return;

      const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `emails-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Export failed",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isFetching}
      className="h-7 text-xs"
    >
      <Download className="mr-1 h-3.5 w-3.5" />
      {isFetching ? "Exporting..." : "Export CSV"}
    </Button>
  );
}
