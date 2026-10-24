import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { parentsRouter } from "./routers/parents";
import { childrenRouter } from "./routers/children";
import { forwardingRouter } from "./routers/forwarding";
import { emailRouter } from "./routers/email";
import { ignoredActivitiesRouter } from "./routers/ignored-activities";
import { priorityActivitiesRouter } from "./routers/priority-activities";
import { activityRouter } from "./routers/activity";
import { senderRulesRouter } from "./routers/sender-rules";
import { allowedSendersRouter } from "./routers/allowed-senders";
import { adminRouter } from "./routers/admin";
import { eventsRouter } from "./routers/events";
import { feedbackRouter } from "./routers/feedback";
import { householdRouter } from "./routers/household";

export const appRouter = router({
  user: userRouter,
  parents: parentsRouter,
  children: childrenRouter,
  forwarding: forwardingRouter,
  email: emailRouter,
  ignoredActivities: ignoredActivitiesRouter,
  priorityActivities: priorityActivitiesRouter,
  activity: activityRouter,
  senderRules: senderRulesRouter,
  allowedSenders: allowedSendersRouter,
  admin: adminRouter,
  events: eventsRouter,
  feedback: feedbackRouter,
  household: householdRouter,
});

export type AppRouter = typeof appRouter;
