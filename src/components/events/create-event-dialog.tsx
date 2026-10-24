"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { todayDateKey, resolveEventDate, endTimeWrapsToNextDay, nextDayDate } from "@/lib/date-utils";
import { SegmentedDateInput, SegmentedTimeInput } from "@/components/ui/segmented-time-input";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string; // YYYY-MM-DD
  children: Array<{ id: string; name: string }>;
}

export function CreateEventDialog({
  open,
  onOpenChange,
  defaultDate,
  children,
}: CreateEventDialogProps) {
  const utils = trpc.useUtils();
  const tz = useTimezone();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? todayDateKey(tz));
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [isTodo, setIsTodo] = useState(false);
  const [location, setLocation] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);

  const createEvent = trpc.events.create.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      utils.events.upcoming.invalidate();
      onOpenChange(false);
      resetForm();
      toast({ title: "Event created" });
    },
    onError: (err) =>
      toast({
        title: "Failed to create event",
        description: err.message,
        variant: "destructive",
      }),
  });

  const resetForm = () => {
    setTitle("");
    setDate(defaultDate ?? todayDateKey(tz));
    setTime("");
    setEndTime("");
    setAllDay(true);
    setIsTodo(false);
    setLocation("");
    setSelectedChildIds([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (!allDay && !time) {
      toast({ title: "Please select a time", variant: "destructive" });
      return;
    }
    const input = allDay ? date : `${date}T${time}`;
    const eventDate = resolveEventDate(input, allDay, tz);
    if (!eventDate) {
      toast({ title: "Invalid date", variant: "destructive" });
      return;
    }

    let endDate: string | undefined;
    if (!allDay && endTime) {
      const endDateStr = endTimeWrapsToNextDay(time, endTime)
        ? nextDayDate(date)
        : date;
      const endDateIso = resolveEventDate(`${endDateStr}T${endTime}`, false, tz);
      if (endDateIso) endDate = endDateIso;
    }

    createEvent.mutate({
      title: title.trim(),
      eventDate,
      endDate: endDate ?? null,
      allDay,
      isTodo,
      location: location.trim() || undefined,
      childIds: selectedChildIds.length > 0 ? selectedChildIds : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Event</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Science Fair"
              maxLength={300}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <SegmentedDateInput
              value={date}
              onChange={setDate}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                id="event-allday"
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="event-allday" className="font-normal">
                All day
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="event-todo"
                type="checkbox"
                checked={isTodo}
                onChange={(e) => {
                  setIsTodo(e.target.checked);
                  if (e.target.checked) setAllDay(true);
                }}
                className="h-4 w-4 rounded border-gray-300 accent-amber-500"
              />
              <Label htmlFor="event-todo" className="font-normal text-amber-600 dark:text-amber-400">
                To-do (no specific date)
              </Label>
            </div>
          </div>

          {!allDay && (
            <div className="flex items-center gap-3">
              <div className="space-y-2">
                <Label>Start time</Label>
                <SegmentedTimeInput
                  value={time}
                  onChange={setTime}
                />
              </div>
              <div className="space-y-2">
                <Label>End time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <SegmentedTimeInput
                  value={endTime}
                  onChange={setEndTime}
                  clearable
                />
              </div>
              {endTime && endTimeWrapsToNextDay(time, endTime) && (
                <span className="self-end pb-2 text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">+1 day</span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="event-location">Location (optional)</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. School gym"
              maxLength={300}
            />
          </div>

          {children.length > 0 && (
            <div className="space-y-2">
              <Label>Children (optional)</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {children.map((child) => (
                  <label
                    key={child.id}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChildIds.includes(child.id)}
                      onChange={(e) => {
                        setSelectedChildIds((prev) =>
                          e.target.checked
                            ? [...prev, child.id]
                            : prev.filter((id) => id !== child.id)
                        );
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {child.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createEvent.isPending}>
              {createEvent.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
