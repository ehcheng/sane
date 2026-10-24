"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FIELD_LIMITS, GRADE_OPTIONS, PRONOUN_OPTIONS, RELATIONSHIP_OPTIONS, type Teacher } from "@/lib/validators";
import { toast } from "@/components/ui/use-toast";

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <span className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            i
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Debug UI flag is DB-driven via user.globalMonitoringStatus
function useShowDebugUI(): boolean {
  const { data } = trpc.user.globalMonitoringStatus.useQuery();
  return data?.showDebugUI ?? false;
}

// ---------------------------------------------------------------------------
// Parents Section
// ---------------------------------------------------------------------------

interface ParentFormData {
  name: string;
  relationship: string;
}

const emptyParentForm: ParentFormData = {
  name: "",
  relationship: "",
};

export function ParentsSection() {
  const { data: parents } = trpc.parents.list.useQuery();
  const utils = trpc.useUtils();

  const createParent = trpc.parents.create.useMutation({
    onSuccess: () => {
      utils.parents.list.invalidate();
      handleCancel();
      toast({ title: "Parent added" });
    },
    onError: (err) => toast({ title: "Failed to add parent", description: err.message, variant: "destructive" }),
  });
  const updateParent = trpc.parents.update.useMutation({
    onSuccess: () => {
      utils.parents.list.invalidate();
      handleCancel();
      toast({ title: "Parent updated" });
    },
    onError: (err) => toast({ title: "Failed to update parent", description: err.message, variant: "destructive" }),
  });
  const deleteParent = trpc.parents.delete.useMutation({
    onSuccess: (data) => {
      utils.parents.list.invalidate();
      if (data.monitoringPaused) {
        utils.user.me.invalidate();
        toast({ title: "Parent removed — monitoring paused", description: "No parents remain. Add a parent to resume monitoring.", variant: "destructive" });
      } else {
        toast({ title: "Parent removed" });
      }
    },
    onError: (err) => toast({ title: "Failed to delete parent", description: err.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<ParentFormData>(emptyParentForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function handleEdit(parent: NonNullable<typeof parents>[number]) {
    setEditingId(parent.id);
    setForm({
      name: parent.name,
      relationship: parent.relationship ?? "",
    });
    setShowForm(true);
  }

  function handleCancel() {
    setForm(emptyParentForm);
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
  const isEmpty = parents?.length === 0;

  const selectClass =
    "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Card className={isEmpty ? "border-red-300 dark:border-red-800" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Parents / Guardians</CardTitle>
            <CardDescription>
              Adults in the household who receive school communications
            </CardDescription>
          </div>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              Add parent
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isEmpty && !showForm && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Required — add at least one parent to enable monitoring.
          </p>
        )}

        {parents?.map((parent) =>
          editingId === parent.id ? null : (
            <div key={parent.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 py-1">
                  <span className="text-sm font-medium">{parent.name}</span>
                  {parent.relationship && (
                    <Badge variant="secondary">{parent.relationship}</Badge>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-3 md:h-8"
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
                        className="h-9 px-3 text-destructive hover:text-destructive md:h-8"
                        disabled={deleteParent.isPending}
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {parent.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove {parent.name} from the household.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteParent.mutate({ id: parent.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          )
        )}

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
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
                  <Button type="submit" size="sm" disabled={isSaving}>
                    {isSaving
                      ? "Saving..."
                      : editingId
                        ? "Save Parent"
                        : "Add Parent"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Children Section
// ---------------------------------------------------------------------------

interface ChildFormData {
  name: string;
  grade: string;
  pronouns: string;
  className: string;
  teachers: Teacher[];
  additionalInfo: string;
}

const emptyChild: ChildFormData = {
  name: "",
  grade: "",
  pronouns: "",
  className: "",
  teachers: [],
  additionalInfo: "",
};

interface TeacherFormData {
  name: string;
  subjects: string;
}

const emptyTeacherForm: TeacherFormData = { name: "", subjects: "" };

function ChildPromptPreview({ childId }: { childId: string }) {
  const { data: prompt, isLoading } = trpc.children.previewPrompt.useQuery(
    { childId },
  );

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading prompt...</p>;
  }

  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
      {prompt}
    </pre>
  );
}

export function ChildrenSection() {
  const showDebugUI = useShowDebugUI();
  const { data: children } = trpc.children.list.useQuery();
  const utils = trpc.useUtils();

  const createChild = trpc.children.create.useMutation({
    onSuccess: () => {
      utils.children.list.invalidate();
      handleCancel();
      toast({ title: "Child added" });
    },
    onError: (err) => toast({ title: "Failed to add child", description: err.message, variant: "destructive" }),
  });
  const updateChild = trpc.children.update.useMutation({
    onSuccess: () => {
      utils.children.list.invalidate();
      handleCancel();
      toast({ title: "Child updated" });
    },
    onError: (err) => toast({ title: "Failed to update child", description: err.message, variant: "destructive" }),
  });
  const deleteChild = trpc.children.delete.useMutation({
    onSuccess: (data) => {
      utils.children.list.invalidate();
      if (data.monitoringPaused) {
        utils.user.me.invalidate();
        toast({ title: "Child removed — monitoring paused", description: "No children remain. Add a child to resume monitoring.", variant: "destructive" });
      } else {
        toast({ title: "Child removed" });
      }
    },
    onError: (err) => toast({ title: "Failed to delete child", description: err.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<ChildFormData>(emptyChild);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [promptChildId, setPromptChildId] = useState<string | null>(null);

  // Teacher inline form state
  const [teacherForm, setTeacherForm] = useState<TeacherFormData>(emptyTeacherForm);
  const [editingTeacherIdx, setEditingTeacherIdx] = useState<number | null>(null);
  const [showTeacherForm, setShowTeacherForm] = useState(false);

  function handleAddTeacher() {
    const name = teacherForm.name.trim();
    if (!name) return;
    const teacher: Teacher = {
      name,
      subjects: teacherForm.subjects.trim() || null,
    };
    setForm((prev) => ({ ...prev, teachers: [...prev.teachers, teacher] }));
    setTeacherForm(emptyTeacherForm);
    setShowTeacherForm(false);
  }

  function handleSaveTeacher() {
    if (editingTeacherIdx === null) return;
    const name = teacherForm.name.trim();
    if (!name) return;
    const teacher: Teacher = {
      name,
      subjects: teacherForm.subjects.trim() || null,
    };
    setForm((prev) => {
      const updated = [...prev.teachers];
      updated[editingTeacherIdx] = teacher;
      return { ...prev, teachers: updated };
    });
    setTeacherForm(emptyTeacherForm);
    setEditingTeacherIdx(null);
    setShowTeacherForm(false);
  }

  function handleEditTeacher(idx: number) {
    const t = form.teachers[idx];
    setTeacherForm({ name: t.name, subjects: t.subjects ?? "" });
    setEditingTeacherIdx(idx);
    setShowTeacherForm(true);
  }

  function handleRemoveTeacher(idx: number) {
    setForm((prev) => ({
      ...prev,
      teachers: prev.teachers.filter((_, i) => i !== idx),
    }));
  }

  function handleCancelTeacher() {
    setTeacherForm(emptyTeacherForm);
    setEditingTeacherIdx(null);
    setShowTeacherForm(false);
  }

  /** Intercept Enter in teacher inputs: save the teacher instead of submitting the child form */
  function handleTeacherKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (teacherForm.name.trim()) {
        if (editingTeacherIdx !== null) {
          handleSaveTeacher();
        } else {
          handleAddTeacher();
        }
      }
    }
  }

  function handleEdit(child: NonNullable<typeof children>[number]) {
    setEditingId(child.id);
    setForm({
      name: child.name,
      grade: child.grade,
      pronouns: child.pronouns ?? "",
      className: child.className ?? "",
      teachers: child.teachers,
      additionalInfo: child.additionalInfo ?? "",
    });
    setShowForm(true);
  }

  function handleCancel() {
    setForm(emptyChild);
    setEditingId(null);
    setShowForm(false);
    handleCancelTeacher();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Auto-save any pending teacher so the user doesn't lose data
    let teachers = form.teachers;
    if (showTeacherForm && teacherForm.name.trim()) {
      const pendingTeacher: Teacher = {
        name: teacherForm.name.trim(),
        subjects: teacherForm.subjects.trim() || null,
      };
      if (editingTeacherIdx !== null) {
        teachers = [...teachers];
        teachers[editingTeacherIdx] = pendingTeacher;
      } else {
        teachers = [...teachers, pendingTeacher];
      }
      setTeacherForm(emptyTeacherForm);
      setEditingTeacherIdx(null);
      setShowTeacherForm(false);
    }

    const payload = {
      name: form.name.trim(),
      grade: form.grade.trim(),
      pronouns: (form.pronouns || null) as "he" | "she" | "they" | null,
      className: form.className.trim() || null,
      teachers,
      additionalInfo: form.additionalInfo.trim() || null,
    };

    if (editingId) {
      updateChild.mutate({ id: editingId, ...payload });
    } else {
      createChild.mutate(payload);
    }
  }

  const isSaving = createChild.isPending || updateChild.isPending;

  const isEmpty = children?.length === 0;

  return (
    <Card className={isEmpty ? "border-red-300 dark:border-red-800" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Children</CardTitle>
            <CardDescription>
              Children tracked from your school email account
            </CardDescription>
          </div>
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              Add child
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isEmpty && !showForm && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Required — add at least one child to enable monitoring.
          </p>
        )}

        {children?.map((child) =>
          editingId === child.id ? null : (
            <div key={child.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{child.name}</span>
                    <Badge variant="secondary">
                      {GRADE_OPTIONS.find((g) => g.value === child.grade)?.label ?? child.grade}
                    </Badge>
                    {child.className && (
                      <Badge variant="outline">{child.className}</Badge>
                    )}
                  </div>
                  {child.teachers.length > 0 && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Teachers: {child.teachers.map((t) => t.subjects ? `${t.name} (${t.subjects})` : t.name).join(", ")}
                    </p>
                  )}
                  {child.additionalInfo && (
                    <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-2">
                      {child.additionalInfo}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-3 md:h-8"
                    onClick={() => handleEdit(child)}
                    disabled={showForm}
                  >
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-3 text-destructive hover:text-destructive md:h-8"
                        disabled={deleteChild.isPending}
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {child.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove {child.name} and their details. Emails
                          already processed will not be affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteChild.mutate({ id: child.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {showDebugUI && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 dark:text-orange-300"
                  onClick={() =>
                    setPromptChildId(
                      promptChildId === child.id ? null : child.id
                    )
                  }
                >
                  {promptChildId === child.id
                    ? "Debug: Hide Prompt"
                    : "Debug: Show AI Prompt"}
                </Button>
              )}
              {showDebugUI && promptChildId === child.id && (
                <ChildPromptPreview childId={child.id} />
              )}
            </div>
          )
        )}

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {editingId ? "Edit Child" : "Add a Child"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="child-name">Name *</Label>
                    <Input
                      id="child-name"
                      placeholder="e.g., Alex"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      required
                      autoFocus
                      maxLength={FIELD_LIMITS.childName}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="child-grade">Grade *</Label>
                    <select
                      id="child-grade"
                      value={form.grade}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, grade: e.target.value }))
                      }
                      required
                      className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="" disabled>Select grade</option>
                      {GRADE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="child-class">Class Name</Label>
                    <Input
                      id="child-class"
                      placeholder="e.g., Room 12"
                      value={form.className}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          className: e.target.value,
                        }))
                      }
                      maxLength={FIELD_LIMITS.childClassName}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="child-pronouns">Pronouns</Label>
                    <select
                      id="child-pronouns"
                      value={form.pronouns}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, pronouns: e.target.value }))
                      }
                      className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Optional</option>
                      {PRONOUN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    Teachers
                    <InfoTip text="Helps the AI recognize emails from or about your child's teachers and route them correctly." />
                  </Label>
                  {form.teachers.length > 0 && (
                    <div className="space-y-1.5">
                      {form.teachers.map((t, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                          <span>
                            {t.name}
                            {t.subjects && <span className="text-muted-foreground"> ({t.subjects})</span>}
                          </span>
                          <div className="ml-2 flex shrink-0 gap-1">
                            <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-xs md:h-7" onClick={() => handleEditTeacher(idx)} disabled={showTeacherForm}>
                              Edit
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-destructive hover:text-destructive md:h-7" onClick={() => handleRemoveTeacher(idx)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {showTeacherForm ? (
                    <div className="rounded-md border border-dashed p-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="teacher-name" className="text-xs">Name *</Label>
                          <Input
                            id="teacher-name"
                            placeholder="e.g., Ms. Smith"
                            value={teacherForm.name}
                            onChange={(e) => setTeacherForm((prev) => ({ ...prev, name: e.target.value }))}
                            onKeyDown={handleTeacherKeyDown}
                            maxLength={FIELD_LIMITS.childTeacherName}
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="teacher-subjects" className="text-xs">Subject(s)</Label>
                          <Input
                            id="teacher-subjects"
                            placeholder="e.g., Math, Science"
                            value={teacherForm.subjects}
                            onChange={(e) => setTeacherForm((prev) => ({ ...prev, subjects: e.target.value }))}
                            onKeyDown={handleTeacherKeyDown}
                            maxLength={FIELD_LIMITS.childTeacherSubjects}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!teacherForm.name.trim()}
                          onClick={editingTeacherIdx !== null ? handleSaveTeacher : handleAddTeacher}
                        >
                          {editingTeacherIdx !== null ? "Save Teacher" : "Add Teacher"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={handleCancelTeacher}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    form.teachers.length < FIELD_LIMITS.childTeachersCount && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-dashed"
                        onClick={() => setShowTeacherForm(true)}
                      >
                        + Add teacher
                      </Button>
                    )
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="child-info">
                    Additional Info (optional)
                    <InfoTip text="Context that helps the AI filter more accurately — e.g., &quot;on the travel soccer team&quot; or &quot;has a peanut allergy.&quot;" />
                  </Label>
                  <textarea
                    id="child-info"
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., On the travel soccer team, takes the school bus, has a peanut allergy"
                    value={form.additionalInfo}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        additionalInfo: e.target.value,
                      }))
                    }
                    maxLength={FIELD_LIMITS.childAdditionalInfo}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={isSaving}>
                    {isSaving
                      ? "Saving..."
                      : editingId
                        ? "Save Child"
                        : "Add Child"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
