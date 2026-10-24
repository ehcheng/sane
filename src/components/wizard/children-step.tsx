"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FIELD_LIMITS, GRADE_OPTIONS, PRONOUN_OPTIONS, type Teacher } from "@/lib/validators";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

export function ChildrenStep() {
  const utils = trpc.useUtils();
  const { data: children = [], isLoading } = trpc.children.list.useQuery();
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
    onSuccess: () => {
      utils.children.list.invalidate();
      toast({ title: "Child removed" });
    },
    onError: (err) => toast({ title: "Failed to remove child", description: err.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<ChildFormData>(emptyChild);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

  function handleEdit(child: (typeof children)[number]) {
    setEditing(child.id);
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
    setEditing(null);
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
      name: form.name,
      grade: form.grade,
      pronouns: (form.pronouns || null) as "he" | "she" | "they" | null,
      className: form.className || null,
      teachers,
      additionalInfo: form.additionalInfo || null,
    };

    if (editing) {
      updateChild.mutate({ id: editing, ...payload });
    } else {
      createChild.mutate(payload);
    }
  }

  const isSaving = createChild.isPending || updateChild.isPending;

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
        <h2 className="text-lg font-semibold">Your Children</h2>
        <p className="text-sm text-muted-foreground">
          Add each child who attends school. We use this information to identify
          which emails are relevant to your family.
        </p>
      </div>

      {children.length > 0 && (
        <div className="space-y-3">
          {children.map((child) => (
            <Card key={child.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{child.name}</span>
                    <Badge variant="secondary">
                      {GRADE_OPTIONS.find((g) => g.value === child.grade)?.label ?? child.grade}
                    </Badge>
                    {child.className && (
                      <Badge variant="outline">{child.className}</Badge>
                    )}
                  </div>
                  {child.teachers.length > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Teachers: {child.teachers.map((t) => t.subjects ? `${t.name} (${t.subjects})` : t.name).join(", ")}
                    </p>
                  )}
                  {child.additionalInfo && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {child.additionalInfo}
                    </p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(child)}
                    disabled={showForm}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteChild.mutate({ id: child.id })}
                    disabled={deleteChild.isPending}
                  >
                    Remove
                  </Button>
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
              {editing ? "Edit Child" : "Add a Child"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
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
                      <div key={idx} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                        <span>
                          {t.name}
                          {t.subjects && <span className="text-muted-foreground"> ({t.subjects})</span>}
                        </span>
                        <div className="ml-2 flex shrink-0 gap-1">
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleEditTeacher(idx)} disabled={showTeacherForm}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={() => handleRemoveTeacher(idx)}>
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
                <Button type="submit" disabled={isSaving}>
                  {isSaving
                    ? "Saving..."
                    : editing
                      ? "Save Child"
                      : "Add Child"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowForm(true)}
          className="w-full border-dashed"
        >
          + Add {children.length === 0 ? "a" : "another"} child
        </Button>
      )}

      {children.length === 0 && !showForm && (
        <p className="text-center text-sm text-muted-foreground">
          You must add at least one child to continue.
        </p>
      )}
    </div>
  );
}
