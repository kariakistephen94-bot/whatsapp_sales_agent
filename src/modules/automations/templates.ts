/** Prebuilt automations every workspace starts with. Placeholders: {name} {business} {service} {time} {date} {staff} {order}. */
export interface AutomationTemplate {
  key: string; name: string; trigger: string; enabledByDefault: boolean;
  description: string;
  config: { template: string; offsetMinutes?: number; requires?: string[]; [k: string]: unknown };
}

export const automationTemplates: AutomationTemplate[] = [
  {
    key: "welcome", name: "Welcome new customers", trigger: "first_message", enabledByDefault: true,
    description: "Creates the customer profile and lets the AI agent greet them with your greeting message.",
    config: { template: "" },
  },
  {
    key: "reminder_24h", name: "24-hour appointment reminder", trigger: "appointment_reminder", enabledByDefault: true,
    description: "Sent 24 hours before each booked appointment.",
    config: { template: "Hello {name}! Just a friendly reminder about your {service} appointment tomorrow at {time}. We look forward to seeing you! Reply here if you need to reschedule.", offsetMinutes: -24 * 60, requires: ["appointments", "reservations"] },
  },
  {
    key: "reminder_2h", name: "2-hour appointment reminder", trigger: "appointment_reminder", enabledByDefault: true,
    description: "Sent 2 hours before each booked appointment.",
    config: { template: "Hi {name}! Your {service} appointment is coming up in 2 hours, at {time}. See you soon!", offsetMinutes: -120, requires: ["appointments", "reservations"] },
  },
  {
    key: "after_visit", name: "Post-visit thank you", trigger: "after_appointment", enabledByDefault: true,
    description: "Sent 2 hours after an appointment ends.",
    config: { template: "Thank you for visiting {business} today, {name}! We hope you enjoyed your {service}. 🙏", offsetMinutes: 120, requires: ["appointments", "reservations"] },
  },
  {
    key: "order_confirmation", name: "Order confirmation", trigger: "post_purchase", enabledByDefault: true,
    description: "Sent when an order is confirmed in the dashboard.",
    config: { template: "Hi {name}, your order {order} has been confirmed. We'll keep you updated. Thank you for shopping with {business}!", requires: ["orders"] },
  },
  {
    key: "abandoned_enquiry", name: "Abandoned enquiry follow-up", trigger: "abandoned_enquiry", enabledByDefault: false,
    description: "If a customer asked about prices but didn't buy or book, follow up once after the delay. Max one per customer every 7 days.",
    config: { template: "Hi {name}, just checking in from {business}. Would you still like help with what you asked about? I'm happy to answer any questions.", offsetMinutes: 24 * 60 },
  },
  {
    key: "customer_care", name: "Keep in touch with customers", trigger: "customer_lifecycle", enabledByDefault: false,
    description: "The AI tracks how often each customer buys or books, and reaches out when they're due back, drifting away, or gone quiet. At most 3 messages per quiet spell, only between the hours you set, and never to anyone who said STOP or is chatting with you.",
    config: {
      template: "Hi {name}, it's been a while since your last visit to {business}. We'd love to see you again — would you like to book or order? Just reply here.",
      aiPersonalize: true, defaultCycleDays: 30, maxNudges: 3, dailyCap: 20, sendFromHour: 9, sendToHour: 19,
    },
  },
];
