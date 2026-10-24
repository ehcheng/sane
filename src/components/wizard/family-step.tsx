"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { FIELD_LIMITS, RELATIONSHIP_OPTIONS } from "@/lib/validators";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { toast } from "@/components/ui/use-toast";
import { ChildrenStep } from "./children-step";

interface ParentFormData {
  name: string;
  relationship: string;
}

const emptyParent: ParentFormData = {
  name: "",
  relationship: "",
};

export function FamilyStep() {
  const utils = trpc.useUtils();
  const { data: me } = trpc.user.me.useQuery();
  const { data: parents = [], isLoading } = trpc.parents.list.useQuery();

  const createParent = trpc.parents.create.useMutation({
    onSuccess: () => {
      utils.parents.list.invalidate();
      setForm(emptyParent);
      setEditingId(null);
      setShowForm(false);
      toast({ title: "Parent added" });
    },
    onError: (err) =>
      toast({
        title: "Failed to add parent",
        description: err.message,
        variant: "destructive",
      }),
  });
  const updateParent = trpc.parents.update.useMutation({
    onSuccess: () => {
      utils.parents.list.invalidate();
      setForm(emptyParent);
      setEditingId(null);
      setShowForm(false);
      toast({ title: "Parent updated" });
    },
    onError: (err) =>
      toast({
        title: "Failed to update parent",
        description: err.message,
        variant: "destructive",
      }),
  });
  const deleteParent = trpc.parents.delete.useMutation({
    onSuccess: () => {
      utils.parents.list.invalidate();
      toast({ title: "Parent removed" });
    },
    onError: (err) =>
      toast({
        title: "Failed to remove parent",
        description: err.message,
        variant: "destructive",
      }),
  });

  const [form, setForm] = useState<ParentFormData>(emptyParent);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Auto-open form with account name when arriving with no parents
  useEffect(() => {
    if (!isLoading && parents.length === 0 && !showForm) {
      setForm({ name: me?.name ?? "", relationship: "" });
      setShowForm(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  function handleEdit(parent: (typeof parents)[number]) {
    setEditingId(parent.id);
    setForm({
      name: parent.name,
      relationship: parent.relationship ?? "",
    });
    setShowForm(true);
  }

  function handleCancel() {
    setForm(emptyParent);
    setEditingId(null);
    setShowForm(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      relationship: form.relationship.trim() || null,
    };

    if (editingId) {
      updateParent.mutate({ id: editingId, ...payload });
    } else {
      createParent.mutate(payload);
    }
  }

  const isSaving = createParent.isPending || updateParent.isPending;

  const selectClass =
    "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Parents sub-section */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Parents / Guardians</h2>
          <p className="text-sm text-muted-foreground">
            Add the parents or guardians in your household. This helps the AI
            recognize when emails are addressed to you personally.
          </p>
        </div>

        {parents.length > 0 && (
          <div className="space-y-3">
            {parents.map((parent) => (
              <Card key={parent.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{parent.name}</span>
                    {parent.relationship && (
                      <Badge variant="secondary">{parent.relationship}</Badge>
                    )}
                  </div>
                  <div className="ml-4 flex shrink-0 gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(parent)}
                      disabled={showForm}
                    >
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteParent.isPending}
                        >
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove {parent.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove {parent.name} from the household.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              deleteParent.mutate({ id: parent.id })
                            }
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showForm ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingId ? "Edit Parent" : "Add a Parent"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="parent-name">Name *</Label>
                    <Input
                      id="parent-name"
                      placeholder="e.g., Sarah"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      required
                      autoFocus
                      maxLength={FIELD_LIMITS.parentName}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="parent-relationship">Relationship</Label>
                    <select
                      id="parent-relationship"
                      value={form.relationship}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          relationship: e.target.value,
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="">Select (optional)</option>
                      {RELATIONSHIP_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={isSaving}>
                    {isSaving
                      ? "Saving..."
                      : editingId
                        ? "Save Parent"
                        : "Add Parent"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              if (parents.length === 0 && me?.name) {
                setForm({ name: me.name, relationship: "" });
              }
              setShowForm(true);
            }}
            className="w-full border-dashed"
          >
            + Add {parents.length === 0 ? "a" : "another"} parent
          </Button>
        )}

        {parents.length === 0 && !showForm && (
          <p className="text-center text-sm text-muted-foreground">
            You must add at least one parent to continue.
          </p>
        )}
      </div>

      <Separator />

      {/* Children sub-section (reuse existing component) */}
      <ChildrenStep />
    </div>
  );
}
