import React from "react";

export interface FaqQuestion {
  question: string;
  answer: React.ReactNode;
  /** Plain-text version of the answer used for search filtering. Required when answer contains JSX. */
  searchText?: string;
}

export interface FaqCategory {
  id: string;
  title: string;
  questions: FaqQuestion[];
}

export const faqCategories: FaqCategory[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    questions: [
      {
        question: "What is SANE and why does it exist?",
        answer:
          "SANE stands for School Alerts, Notices & Essentials. It monitors your school email inbox and uses AI to surface what actually matters: action items, deadlines, events, and schedule changes. Think of it as a smart filter that processes all the school email so you don't have to.",
      },
      {
        question: "Who is SANE built for?",
        answer:
          "Parents and caregivers who receive school emails and want to make sure nothing important slips through the cracks. It's especially useful for busy families juggling multiple kids, schools, or activities where the volume of school email can be overwhelming.",
      },
      {
        question: "Who is behind SANE?",
        answer:
          "SANE was built by an individual developer to solve this problem for their own family. It's a personal project currently being shared with friends and family during this early beta phase.",
      },
      {
        question: "What email systems does SANE work with?",
        answer:
          "SANE currently supports Gmail only. Support for Microsoft 365 (Outlook) is on the roadmap. SANE works with any school communication that arrives in your email inbox, including notifications from platforms like ParentSquare, Konstella, Bloomz, Remind, and others.",
      },
      {
        question:
          "Will SANE work with my school's ParentSquare, Konstella, Bloomz, or other communication platform?",
        answer:
          "Yes, as long as those platforms send email notifications to your inbox. SANE monitors your email, so it picks up notifications from any platform that emails you. It doesn't connect directly to those platforms; it processes the emails they send. Note that SANE does not visit or fetch linked pages. It can only work with content included in the email itself, though it may extract and display actionable links for your convenience.",
      },
      {
        question:
          "Should I use a dedicated email address for school emails, or can I connect my personal/shared account?",
        answer:
          "Either works. If your school emails go to your main Gmail, connect that. SANE is configured to only process emails from your school's senders, so your personal email is ignored. If you have (or want to create) a dedicated address that only receives school email, that can reduce noise further. Either way, SANE won't interfere with your other mail.",
      },
      {
        question: "How do I sign up for the beta?",
        searchText:
          "Beta access is by invitation. If you'd like to try SANE, send us a message through our contact form and we'll get you set up.",
        answer: (
          <span>
            Beta access is by invitation. If you&apos;d like to try SANE, send
            us a message through our{" "}
            <a
              href="/contactsane"
              className="underline underline-offset-4 hover:text-foreground"
            >
              contact form
            </a>{" "}
            and we&apos;ll get you set up.
          </span>
        ),
      },
      {
        question: "Is SANE free during the beta?",
        answer:
          "Yes, SANE is completely free during the beta period.",
      },
    ],
  },
  {
    id: "connecting-your-email",
    title: "Connecting Your Email",
    questions: [
      {
        question:
          "Is SANE's Gmail access verified by Google?",
        answer:
          "Yes. SANE is a Google OAuth Verified application, meaning it has passed Google's security review process. Your Gmail connection will persist long-term without needing periodic reconnection.",
      },
      {
        question: "What Gmail permissions does SANE request, and why?",
        answer:
          "SANE requests read-only access to your Gmail messages. This allows it to process incoming emails so it can summarize and categorize them. SANE does not request permission to send, delete, or modify any emails in your account.",
      },
      {
        question: "Will SANE ever send emails from my account?",
        answer:
          "No, never. SANE only requests read-only access to your Gmail, so it doesn't even have permission to send email from your account. All outbound emails (forwards and briefs) are sent from SANE's own domain using a separate email delivery service.",
      },
      {
        question: "Can I connect more than one email account?",
        answer:
          "Not currently. Each SANE account supports one connected Gmail account. If you receive school emails at multiple addresses, consider setting up forwarding in Gmail to consolidate them into one inbox.",
      },
    ],
  },
  {
    id: "how-sane-works",
    title: "How SANE Works",
    questions: [
      {
        question:
          "What's the difference between individual email forwards and daily/weekly briefs?",
        answer:
          "Individual forwards send you a summarized version of each actionable email as it's processed (roughly every 15 minutes). Briefs are scheduled digests: the daily brief arrives each morning with a summary of recent activity and upcoming events, and the weekly brief arrives on weekends with a broader overview. You can enable any combination of these independently. Note: if you're using a shared email account (where SANE monitors the same inbox it would forward to), individual forwarding is not available since it would just send emails back to the same address. Briefs still work in this setup.",
      },
      {
        question: "When should I use forwards vs. briefs?",
        answer:
          "Use individual forwards if you want near-real-time alerts for action items like permission slips due tomorrow or schedule changes. Use briefs for a calmer, batched overview. Many people use both: forwards to never miss a deadline, and a brief to plan the week ahead without digging through their inbox.",
      },
      {
        question: "How does the AI summarization work? How accurate is it?",
        answer:
          "SANE sends email content to an AI model (currently Google Gemini, mostly because of its native multimodality for PDFs) which extracts key information: what the email is about, whether action is needed, relevant dates, and which of your children it relates to. Accuracy is generally good for straightforward school emails, but AI can occasionally miss nuance or misinterpret context. That's why we include feedback buttons on every forwarded email. Your feedback helps us improve.",
      },
      {
        question: "What are the links shown in forwarded emails and on the Events page?",
        searchText:
          "When an email contains sign-up forms, payment links, RSVPs, or other actionable URLs, they're extracted and shown in forwarded emails and on the Events page. Each link shows the destination domain so you can verify it visually before clicking. You can turn this feature off in Settings > Delivery > Advanced. Extracted links aren't yet shown in Daily or Weekly briefs.",
        answer: (
          <span>
            When an email contains sign-up forms, payment links, RSVPs, or other
            actionable URLs, they&apos;re extracted and shown in forwarded emails
            and on the Events page. Each link shows the destination domain so you
            can verify it visually before clicking. You can turn this feature off
            in <em>Settings &gt; Delivery &gt; Advanced</em>. Extracted links
            aren&apos;t yet shown in Daily or Weekly briefs.
          </span>
        ),
      },
      {
        question: "How quickly are new emails processed?",
        answer:
          "SANE checks for new emails approximately every 15 minutes. So there may be a short delay between when an email arrives in your inbox and when SANE processes and forwards it.",
      },
      {
        question: "Can I customize what gets summarized or forwarded?",
        answer:
          "Yes. You can set sender rules to always or never forward emails from specific senders. You can also configure ignored activities (like recurring newsletters you don't need summarized), adjust brief scope (actionable emails only vs. everything), and choose which delivery methods are active.",
      },
      {
        question:
          "What happens to emails SANE can't categorize or summarize well?",
        answer:
          'They\'ll still appear in your briefs (if you have brief scope set to "all"), but may have less useful summaries. If you notice a bad summary, use the feedback buttons on the forwarded email to flag it, or submit details through the Feedback form in the app. This helps us tune the AI.',
      },
      {
        question: "Does SANE handle attachments and PDFs?",
        answer:
          "SANE detects attachments and includes them when forwarding individual emails. It will note in summaries that attachments are present (for example, \"includes a permission slip PDF\"). The AI processes attachment content like PDFs and images but does not visit or fetch linked pages.",
      },
      {
        question: "Can I use SANE for non-school emails too?",
        answer:
          "SANE is designed and tuned for school-related communications. It will process all emails in your connected inbox, but the AI is optimized to identify and summarize school-related content. Non-school emails may not be categorized as usefully.",
      },
    ],
  },
  {
    id: "tips-tricks",
    title: "Tips & Tricks",
    questions: [
      {
        question: "What's the best way to use SANE?",
        answer:
          "SANE is flexible. You can rely on forwarded email summaries, visit the app or Events page directly, subscribe to the iCal feed in your existing calendar, or combine all three. Consider what fits your routine: some parents prefer real-time email forwards so nothing slips through, others check the app once a day, and many subscribe to the calendar feed so school events appear alongside everything else. There's no wrong approach, and you can adjust anytime.",
      },
      {
        question: "How do I get the most out of filtering?",
        searchText:
          "Set up Fine-tuning in Settings > Delivery > Advanced to teach SANE what matters to your family. Add Priority Activities for things you never want to miss, Ignored Activities for things you don't care about, and Sender Rules to always or never forward specific senders. These settings shape the entire pipeline: forwarding, events, and your calendar.",
        answer: (
          <span>
            Set up{" "}
            <a
              href="/settings#fine-tuning"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Fine-tuning
            </a>{" "}
            in <em>Settings &gt; Delivery &gt; Advanced</em> to teach SANE what
            matters to your family. Add Priority Activities for things you never
            want to miss, Ignored Activities for things you don&apos;t care
            about, and Sender Rules to always or never forward specific senders.
            These settings shape the entire pipeline: forwarding, events, and
            your calendar.
          </span>
        ),
      },
      {
        question: "Should I manage my Events page?",
        answer:
          "Yes. SANE extracts events automatically, but AI isn't perfect. Take a moment to review your Events page occasionally: delete duplicates or irrelevant items, edit details that need correcting, and mark things as complete. Keeping your events tidy makes the calendar feed and briefs more useful.",
      },
      {
        question: "Can I use SANE like a native app on my phone?",
        answer:
          "Yes. On both iOS and Android, you can save SANE to your home screen as a Progressive Web App (PWA). It opens full-screen, supports push notifications, and looks and feels like a native app. On iOS, open SANE in Safari, tap the share button, and choose \"Add to Home Screen.\" On Android, Chrome will prompt you automatically, or you can tap the menu and choose \"Install app.\"",
      },
      {
        question: "How can I help improve SANE?",
        searchText:
          "Use the Feedback form (available from the navigation menu when signed in) to report bugs, suggest features, or flag a bad summary. For individual emails, use the thumbs up/down buttons on forwarded messages. Every piece of feedback helps us improve the AI and the product.",
        answer: (
          <span>
            Use the{" "}
            <a
              href="/feedback"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Feedback form
            </a>{" "}
            (available from the navigation menu when signed in) to report bugs,
            suggest features, or flag a bad summary. For individual emails, use
            the thumbs up/down buttons on forwarded messages. Every piece of
            feedback helps us improve the AI and the product.
          </span>
        ),
      },
    ],
  },
  {
    id: "security-privacy",
    title: "Security & Privacy",
    questions: [
      {
        question: "What data does SANE store, and for how long?",
        answer:
          "SANE stores email metadata (sender, subject line, date) and AI-generated summaries. It does not store full email bodies. Your children's information and forwarding addresses are encrypted at rest. Data is retained as long as your account is active. Deleting your account removes all stored data.",
      },
      {
        question: "How is my data encrypted and protected?",
        answer:
          "Sensitive data (children's names, forwarding addresses, API keys) is encrypted at rest using AES-256-GCM. The app enforces HTTPS, uses secure authentication with hashed passwords, and applies rate limiting to prevent abuse. Gmail OAuth tokens are also encrypted at rest. SANE is a Google OAuth Verified application, meaning Google has reviewed and approved our security practices for accessing Gmail data.",
      },
      {
        question: "Can SANE employees read my emails?",
        answer:
          "SANE does not store full email content. During the beta, the developer can see email header information (sender, subject, date) and AI-generated summaries for debugging purposes only. Full email bodies are not stored or accessible. This access will be further restricted as the product matures.",
      },
      {
        question: "What happens to my data if I delete my account?",
        answer:
          "All of your data is permanently deleted: your profile, connected email tokens, children's information, forwarding addresses, email metadata, summaries, and events. This cannot be undone.",
      },
      {
        question:
          "Which AI provider processes my emails, and is my data used to train AI models?",
        searchText:
          "SANE currently uses Google Gemini via the paid API. Under Google's API terms of service, data sent through the paid Gemini API is not used to train their models. The AI provider may change over time as we evaluate options, but we will always use providers whose API terms prohibit training on customer data.",
        answer: (
          <span>
            SANE currently uses Google Gemini via the paid API. Under
            Google&apos;s API terms of service, data sent through the paid
            Gemini API is not used to train their models. The AI provider may
            change over time as we evaluate options, but we will always use
            providers whose API terms prohibit training on customer data. You can
            review{" "}
            <a
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Google&apos;s Gemini API terms
            </a>{" "}
            for details.
          </span>
        ),
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    questions: [
      {
        question: "I'm not receiving my briefs. What should I check?",
        answer:
          "First, verify that briefs are enabled in Settings (daily and weekly are separate toggles). Check that your Gmail connection is active in Settings. Also check your spam or junk folder, since SANE emails come from a different domain than your school.",
      },
      {
        question:
          "A summary seems wrong or is missing important details. What should I do?",
        answer:
          "Use the feedback buttons (thumbs up/down) on the forwarded email to flag it. You can also submit more detailed feedback through the Feedback form in the app. This feedback directly helps improve how SANE processes similar emails in the future.",
      },
      {
        question: "What happens if SANE misses something important?",
        answer:
          "SANE is designed to catch everything important, but no system is perfect. If SANE missed something it should have caught, please let us know through the Feedback form so we can improve. We also recommend an occasional glance at your inbox until you've built confidence in the system.",
      },
      {
        question: "I disconnected Gmail by accident. How do I reconnect?",
        answer:
          "Go to Settings and click the button to connect your Gmail account. You'll go through the Google OAuth flow again. Your existing configuration (children, sender rules, forwarding addresses) is preserved. Only the email connection needs to be re-established.",
      },
      {
        question:
          "I connected Gmail but SANE says email read permission is required. What happened?",
        answer:
          "During the Google sign-in flow, Google shows a list of permissions that SANE is requesting. If you declined the email read permission, SANE can't access your inbox. To fix this, go to Settings, disconnect Gmail, and reconnect, making sure you grant the email read permission when Google asks.",
      },
    ],
  },
  {
    id: "beta-testing",
    title: "Beta Testing",
    questions: [
      {
        question: 'What does "beta" mean? What should I expect?',
        answer:
          "SANE is a robust, actively developed product that handles school email reliably for real families every day. That said, beta means development is ongoing. You may occasionally encounter a rough edge, a summary that misses the mark, or a new feature that needs polish. We ship improvements frequently, and your feedback directly shapes what comes next.",
      },
      {
        question: "Should I still check my inbox directly during the beta?",
        answer:
          "SANE is designed to catch everything important, and most users find they can rely on it day-to-day. That said, we still recommend an occasional glance at your inbox until you've built confidence in the system. As you use SANE and fine-tune your settings, you'll likely find you need to check less and less.",
      },
      {
        question: "What's the best way to give feedback or report a bug?",
        answer:
          "Use the Feedback form in the app (available from the navigation menu when you're signed in). You can categorize your feedback as a bug report, feature request, or general comment. For issues with specific email summaries, use the thumbs up/down buttons on the forwarded email itself.",
      },
      {
        question: "What's on the roadmap?",
        answer:
          "The top priorities are Microsoft 365 (Outlook) support and ongoing improvements to AI accuracy. Beyond that, the roadmap is driven by user feedback. If there's something you'd like to see, let us know.",
      },
    ],
  },
  {
    id: "households",
    title: "Households (Beta)",
    questions: [
      {
        question: "What is a Household in SANE?",
        answer:
          "A Household lets multiple parents or caregivers (up to 6) share a single SANE setup. One person creates the household and is the owner. They invite partners, who join and share the same children, events, email processing, and calendar feed. Everyone stays in sync without duplicating work.",
      },
      {
        question: "Who should create the Household?",
        answer:
          "The parent whose Gmail is connected to SANE should create the household. They become the owner, and their email connection, children, and events become the shared data for the household. The partner who joins will see and receive the same information.",
      },
      {
        question: "What happens to my data when I join a household?",
        answer:
          "When you accept a household invite, your existing events, children, parent profiles, and email processing rules are permanently deleted. You will share the household owner's data instead. Your forwarding addresses and email connection are preserved, so you will continue receiving briefs at your own addresses.",
      },
      {
        question: "Does each household member get their own briefs and calendar?",
        answer:
          "Yes. Each household member has their own delivery settings: separate forwarding addresses, independent daily/weekly brief toggles, and their own brief schedule. Each member also gets their own calendar feed URL. The content comes from the shared household data, but delivery is individual.",
      },
      {
        question: "Can all household members connect their Gmail accounts?",
        answer:
          "Yes. Each household member can connect their own Gmail. Emails from all connected inboxes are processed into the shared household data pool, so events and summaries from any member's school emails appear together.",
      },
      {
        question: "What happens if I leave a household?",
        answer:
          "If you leave (or are removed), you will be signed out and will need to set up your own account from scratch. Your forwarding addresses are preserved, but you will no longer have access to the shared events, children, or email processing. You will go through the setup wizard again to configure your own account.",
      },
      {
        question: "Can the household owner see my forwarding addresses?",
        answer:
          "No. Forwarding addresses are private to each user. The owner cannot see or modify your delivery destinations, and you cannot see theirs.",
      },
      {
        question: "Is the Households feature stable?",
        answer:
          "Households is currently in beta. The core sharing works reliably, but some edge cases are still being refined. If you run into issues, please use the Feedback form to let us know.",
      },
    ],
  },
  {
    id: "account-settings",
    title: "Account & Settings",
    questions: [
      {
        question: "Can I change my forwarding address or brief schedule?",
        answer:
          "Yes. Go to Settings to manage your forwarding addresses, toggle individual forwarding or briefs on or off, and adjust brief scope. Changes take effect immediately.",
      },
      {
        question:
          "Can I add a second parent or co-parent to receive briefs?",
        answer:
          "Yes. The simplest option is to add their email as a forwarding address in Settings. For a richer experience, create a Household: your partner gets their own login, their own delivery schedule, their own calendar feed, and shared access to all events and children. See the Households section below for details.",
      },
      {
        question: "How do I pause or stop SANE temporarily?",
        answer:
          "In Settings, you can disable individual forwarding and briefs independently. You can also disconnect your Gmail account entirely to stop all processing. Your configuration is preserved so you can re-enable anytime.",
      },
      {
        question: "How do I delete my account and all my data?",
        answer:
          "Go to Settings, then Account, and use the delete account option. This permanently removes all your data including your profile, email connections, children's information, forwarding addresses, and all stored email metadata and summaries. This action cannot be undone.",
      },
    ],
  },
];
