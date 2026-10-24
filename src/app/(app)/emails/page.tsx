import { redirect } from "next/navigation";

export default function EmailsRoute() {
  redirect("/settings#email-log");
}
