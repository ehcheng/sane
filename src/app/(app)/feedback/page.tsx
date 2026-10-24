"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/validators";
import { MessageSquarePlus, Lightbulb } from "lucide-react";

const PAGE_OPTIONS = [
  { value: "events", label: "Events" },
  { value: "settings", label: "Settings" },
  { value: "setup-wizard", label: "Setup Wizard" },
  { value: "forwarded-emails", label: "Forwarded Emails" },
  { value: "gmail-connection", label: "Gmail Connection" },
  { value: "other", label: "Other / General" },
] as const;

export default function FeedbackPage() {
  const pathname = usePathname();

  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("");

  const submitFeedback = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      toast({ title: "Feedback submitted", description: "Thank you! We'll review your feedback." });
      setCategory("");
      setSubject("");
      setMessage("");
      setPage("");
    },
    onError: (err) =>
      toast({
        title: "Failed to submit feedback",
        description: err.message,
        variant: "destructive",
      }),
  });

  const canSubmit =
    category !== "" && subject.trim().length > 0 && message.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitFeedback.isPending) return;
    submitFeedback.mutate({
      category: category as FeedbackCategory,
      subject: subject.trim(),
      message: message.trim(),
      page: page || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground">
          Help us improve by sharing your thoughts, reporting bugs, or requesting features.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-900 dark:text-blue-200">
            <Lightbulb className="h-5 w-5" />
            Before you submit, try fine-tuning
          </CardTitle>
          <CardDescription className="text-blue-800/80 dark:text-blue-300/80">
            Many filtering and delivery issues can be resolved by adjusting your
            fine-tuning settings. These are found in{" "}
            <a
              href="/settings#fine-tuning"
              className="font-medium underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100"
            >
              Settings &rarr; Delivery &rarr; Advanced
            </a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-blue-900/90 dark:text-blue-200/90 space-y-2">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Priority Activities</strong> &ndash; Keywords for activities
              that should always surface, even if SANE&apos;s AI would otherwise
              filter them out (e.g. &quot;soccer practice&quot;, &quot;piano
              recital&quot;). Matching emails are treated as actionable for
              forwarding, events, and TO-DOs on your calendar.
            </li>
            <li>
              <strong>Ignored Activities</strong> &ndash; Keywords for activities
              you never care about (e.g. &quot;fundraiser&quot;, &quot;PTA
              meeting&quot;). Emails primarily about an ignored activity are
              filtered out entirely: no forwarding, no extracted events, and
              nothing added to your calendar.
            </li>
            <li>
              <strong>Sender Rules</strong> &ndash; Per-sender overrides to always
              forward or never forward emails from a specific address,
              regardless of content.
            </li>
          </ul>
          <p className="text-xs text-blue-700/70 dark:text-blue-400/70 pt-1">
            These settings affect the full pipeline, not just forwarding. Even
            if you only use SANE for the calendar and events view, Priority and
            Ignored Activities will shape what shows up there.
          </p>
          <p className="text-xs text-blue-700/70 dark:text-blue-400/70">
            If fine-tuning doesn&apos;t solve the problem, we&apos;d love to hear about it below.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5" />
            Submit Feedback
          </CardTitle>
          <CardDescription>
            All feedback is sent directly to the admin team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                value={category}
                onValueChange={(val) => setCategory(val as FeedbackCategory)}
              >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <span>{cat.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        — {cat.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Related area */}
            <div className="space-y-2">
              <Label htmlFor="page">Related Area</Label>
              <Select value={page} onValueChange={setPage}>
                <SelectTrigger id="page">
                  <SelectValue placeholder="Which part of the app? (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                placeholder="Brief summary of your feedback"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="message">Message *</Label>
              <Textarea
                id="message"
                placeholder="Describe your feedback in detail..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={5000}
                rows={6}
              />
              <p className="text-xs text-muted-foreground text-right">
                {message.length} / 5000
              </p>
            </div>

            <Button type="submit" disabled={!canSubmit || submitFeedback.isPending}>
              {submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
