import { z } from "zod";

// Single source of truth for all user-editable field limits.
// Shared by Zod schemas, HTML maxLength attributes, and Prisma @db.VarChar.
export const FIELD_LIMITS = {
  parentName: 100,
  parentRelationship: 50,
  childName: 100,
  childGrade: 30,
  childClassName: 50,
  childTeacherName: 75,
  childTeacherSubjects: 150,
  childTeachersCount: 10,
  childAdditionalInfo: 300,
  ignoredActivityName: 75,
  ignoredActivitiesCount: 25,
  priorityActivityName: 75,
  priorityActivitiesCount: 25,
  forwardingName: 100,
  forwardingLabel: 30,
  senderRulesCount: 50,
  allowedSendersCount: 50,
} as const;

export const GRADE_OPTIONS = [
  { value: "pre-k", label: "Pre-K" },
  { value: "preschool", label: "Pre-School" },
  { value: "tk", label: "Transitional Kindergarten (TK)" },
  { value: "kindergarten", label: "Kindergarten" },
  { value: "1st", label: "1st Grade" },
  { value: "2nd", label: "2nd Grade" },
  { value: "3rd", label: "3rd Grade" },
  { value: "4th", label: "4th Grade" },
  { value: "5th", label: "5th Grade" },
  { value: "6th", label: "6th Grade" },
  { value: "7th", label: "7th Grade" },
  { value: "8th", label: "8th Grade" },
  { value: "9th", label: "9th Grade" },
  { value: "10th", label: "10th Grade" },
  { value: "11th", label: "11th Grade" },
  { value: "12th", label: "12th Grade" },
  { value: "college-freshman", label: "College Freshman" },
  { value: "college-sophomore", label: "College Sophomore" },
  { value: "college-junior", label: "College Junior" },
  { value: "college-senior", label: "College Senior" },
] as const;

export const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Central Europe (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
] as const;

export const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

/** Weekly briefs only make sense Fri-Sun when the upcoming school week is next Mon-Fri. */
export const WEEKLY_BRIEF_DAY_OPTIONS = [
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
] as const;

export const WEEKLY_BRIEF_VALID_DAYS = new Set([0, 5, 6]);

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`,
}));

/** Brief hours restricted to 6am-9pm — nobody needs a school digest at 3am. */
export const BRIEF_HOUR_OPTIONS = HOUR_OPTIONS.filter(
  (opt) => opt.value >= 6 && opt.value <= 21
);

export const PRONOUN_OPTIONS = [
  { value: "he", label: "He/Him" },
  { value: "she", label: "She/Her" },
  { value: "they", label: "They/Them" },
] as const;

export const RELATIONSHIP_OPTIONS = [
  { value: "Mom", label: "Mom" },
  { value: "Dad", label: "Dad" },
  { value: "Guardian", label: "Guardian" },
  { value: "Step-Mom", label: "Step-Mom" },
  { value: "Step-Dad", label: "Step-Dad" },
  { value: "Other", label: "Other" },
] as const;

export const teacherSchema = z.object({
  name: z.string().min(1, "Name is required").max(FIELD_LIMITS.childTeacherName),
  subjects: z.string().max(FIELD_LIMITS.childTeacherSubjects).optional().nullable(),
});
export type Teacher = z.infer<typeof teacherSchema>;

export const parentSchema = z.object({
  name: z.string().min(1, "Name is required").max(FIELD_LIMITS.parentName),
  relationship: z.string().max(FIELD_LIMITS.parentRelationship).optional().nullable(),
});

export const createParentSchema = parentSchema;
export const updateParentSchema = parentSchema.partial().extend({
  id: z.string().uuid(),
});

export const childSchema = z.object({
  name: z.string().min(1, "Name is required").max(FIELD_LIMITS.childName),
  grade: z.string().min(1, "Grade is required").max(FIELD_LIMITS.childGrade),
  className: z.string().max(FIELD_LIMITS.childClassName).optional().nullable(),
  teachers: z.array(teacherSchema).max(FIELD_LIMITS.childTeachersCount).default([]),
  additionalInfo: z.string().max(FIELD_LIMITS.childAdditionalInfo).optional().nullable(),
  pronouns: z.enum(["he", "she", "they"]).optional().nullable(),
});

export const createChildSchema = childSchema;
export const updateChildSchema = childSchema.partial().extend({
  id: z.string().uuid(),
});

export const forwardingAddressSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
  name: z.string().max(FIELD_LIMITS.forwardingName).optional().nullable(),
  label: z.string().max(FIELD_LIMITS.forwardingLabel).optional().nullable(),
});

export const createForwardingAddressSchema = forwardingAddressSchema;
export const updateForwardingAddressSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email("Invalid email address").max(320).optional(),
  name: z.string().max(FIELD_LIMITS.forwardingName).optional().nullable(),
  label: z.string().max(FIELD_LIMITS.forwardingLabel).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const ignoredActivitySchema = z.object({
  name: z.string().min(1, "Activity name is required").max(FIELD_LIMITS.ignoredActivityName),
});

export const priorityActivitySchema = z.object({
  name: z.string().min(1, "Activity name is required").max(FIELD_LIMITS.priorityActivityName),
});

export const signUpSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address").max(320),
  password: z.string().min(12, "Password must be at least 12 characters").max(128, "Password must be at most 128 characters"),
  accessCode: z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").max(320),
  password: z.string().min(1, "Password is required").max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: z.string().min(12, "Password must be at least 12 characters").max(128, "Password must be at most 128 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const changeEmailSchema = z.object({
  newEmail: z.string().email("Invalid email address").max(320),
  currentPassword: z.string().min(1, "Current password is required").max(128),
});

// AI event extraction
export const aiEventSchema = z.object({
  title: z.string(),
  date: z.string(),
  endDate: z.string().optional().nullable(),
  allDay: z.boolean().optional().default(true),
  isTodo: z.boolean().optional().default(false),
  childName: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  details: z.string().optional().nullable(),
});

// AI link extraction
export const aiLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().max(200),
});

// AI response validation
export const aiResponseSchema = z.object({
  relevant: z.boolean(),
  send: z.boolean(),
  subject: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  children: z.array(z.string()).optional().nullable(),
  reasoning: z.string().optional().nullable(),
  events: z.array(aiEventSchema).optional().nullable(),
  links: z.array(aiLinkSchema).optional().nullable(),
  topicSlug: z.string().max(80).optional().nullable(),
});

export type AIResponse = z.infer<typeof aiResponseSchema>;

// Feedback
export const feedbackValueSchema = z.enum(["correct", "wrong_forward", "wrong_skip"]);
export type FeedbackValue = z.infer<typeof feedbackValueSchema>;

export const submitFeedbackSchema = z.object({
  emailId: z.string().uuid(),
  feedback: feedbackValueSchema,
  reason: z.string().max(500).optional(),
});

// Event feedback
export const eventFeedbackValueSchema = z.enum(["correct", "wrong_event"]);
export type EventFeedbackValue = z.infer<typeof eventFeedbackValueSchema>;

export const submitEventFeedbackSchema = z.object({
  eventId: z.string().uuid(),
  feedback: eventFeedbackValueSchema,
  reason: z.string().max(500).optional(),
});

// Email source filter
export const emailFilterModeSchema = z.enum(["ALL", "ALLOWED_ONLY"]);
export type EmailFilterMode = z.infer<typeof emailFilterModeSchema>;

// Brief scope
export const briefScopeEnum = z.enum(["ACTIONABLE", "ALL"]);
export type BriefScope = z.infer<typeof briefScopeEnum>;

export const createAllowedSenderSchema = z.object({
  pattern: z.string().min(1, "Pattern is required").max(320),
});

// User feedback (app-level feedback from users to admin)
export const feedbackCategorySchema = z.enum([
  "BUG",
  "FEATURE_REQUEST",
  "USABILITY",
  "EMAIL_QUALITY",
  "GENERAL",
]);
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

export const FEEDBACK_CATEGORIES = [
  { value: "BUG" as const, label: "Bug Report", description: "Something isn't working correctly" },
  { value: "FEATURE_REQUEST" as const, label: "Feature Request", description: "Suggest a new feature or improvement" },
  { value: "USABILITY" as const, label: "Usability", description: "Hard to use or confusing" },
  { value: "EMAIL_QUALITY" as const, label: "Email Quality", description: "AI filtering or summary accuracy" },
  { value: "GENERAL" as const, label: "General", description: "Other feedback or comments" },
] as const;

export const submitUserFeedbackSchema = z.object({
  category: feedbackCategorySchema,
  subject: z.string().min(1, "Subject is required").max(200),
  message: z.string().min(1, "Message is required").max(5000),
  page: z.string().max(100).optional(),
});

// Sender rules
export const senderRuleActionSchema = z.enum(["ALWAYS_FORWARD", "NEVER_FORWARD"]);
export type SenderRuleAction = z.infer<typeof senderRuleActionSchema>;

export const createSenderRuleSchema = z.object({
  senderEmail: z.string().email("Invalid email address").max(320),
  action: senderRuleActionSchema,
});
