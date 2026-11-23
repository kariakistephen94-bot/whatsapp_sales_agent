/**
 * Industry templates drive: capabilities, onboarding questions, AI tools, nav, KPIs, terminology.
 * Adding a niche = adding an entry here; no other code changes.
 */
export type Capability = "products" | "services" | "menu" | "appointments" | "orders" | "reservations" | "delivery" | "inventory";

export type AiTool =
  | "search_products" | "get_product_details" | "check_inventory" | "create_order"
  | "get_customer_profile" | "update_customer_profile"
  | "check_appointment_availability" | "book_appointment" | "reschedule_appointment" | "cancel_appointment"
  | "create_customer_followup" | "check_order_status" | "escalate_to_human" | "send_item_photos" | "send_payment_link";

export interface OnboardingField {
  key: string; label: string;
  type: "text" | "textarea" | "number" | "hours" | "list" | "toggle";
  hint?: string;
}

export interface IndustryTemplate {
  key: string;
  label: string;
  capabilities: Capability[];
  terms: { customer: string; item: string; items: string; order: string; booking: string };
  operationsFields: OnboardingField[];
  kpis: string[];
  tools?: AiTool[]; // derived from capabilities when omitted
}

const common: OnboardingField[] = [
  { key: "hours", label: "Working hours", type: "hours" },
];

export const INDUSTRIES: Record<string, IndustryTemplate> = {
  salon: {
    key: "salon", label: "Hair salons & barbershops",
    capabilities: ["services", "appointments"],
    terms: { customer: "Client", item: "Service", items: "Services", order: "Order", booking: "Appointment" },
    operationsFields: [
      { key: "services", label: "Services, prices & durations", type: "list" },
      ...common,
      { key: "stylists", label: "Stylists", type: "list", hint: "One name per line" },
      { key: "bookingPolicy", label: "Booking policy", type: "textarea" },
      { key: "cancellationPolicy", label: "Cancellation policy", type: "textarea" },
    ],
    kpis: ["bookings", "repeat_appointments", "attendance", "revenue"],
  },
  beauty: {
    key: "beauty", label: "Beauty & skincare",
    capabilities: ["products", "services", "appointments", "orders", "delivery"],
    terms: { customer: "Client", item: "Product / Service", items: "Products & Services", order: "Order", booking: "Appointment" },
    operationsFields: [
      { key: "catalog", label: "Products & treatments", type: "list" }, ...common,
      { key: "deliveryOptions", label: "Delivery options", type: "textarea" },
    ],
    kpis: ["bookings", "orders", "revenue", "repeat_purchases"],
  },
  fashion: {
    key: "fashion", label: "Fashion & clothing",
    capabilities: ["products", "orders", "delivery", "inventory"],
    terms: { customer: "Customer", item: "Product", items: "Products", order: "Order", booking: "Booking" },
    operationsFields: [
      { key: "products", label: "Products, sizes, colors, prices & stock", type: "list" },
      { key: "deliveryOptions", label: "Delivery options", type: "textarea" },
      { key: "returnPolicy", label: "Return policy", type: "textarea" },
    ],
    kpis: ["orders", "revenue", "aov", "repeat_purchases"],
  },
  restaurant: {
    key: "restaurant", label: "Restaurants & food",
    capabilities: ["menu", "orders", "delivery", "reservations"],
    terms: { customer: "Guest", item: "Menu item", items: "Menu", order: "Order", booking: "Reservation" },
    operationsFields: [
      { key: "menu", label: "Menu & prices", type: "list" }, ...common,
      { key: "delivery", label: "Delivery options", type: "textarea" },
      { key: "pickup", label: "Pickup available", type: "toggle" },
      { key: "reservations", label: "Table reservations", type: "toggle" },
    ],
    kpis: ["orders", "revenue", "aov", "reservations"],
  },
  hospitality: {
    key: "hospitality", label: "Hotels & hospitality",
    capabilities: ["services", "reservations", "appointments"],
    terms: { customer: "Guest", item: "Room / Service", items: "Rooms & Services", order: "Order", booking: "Reservation" },
    operationsFields: [{ key: "rooms", label: "Rooms/services & rates", type: "list" }, ...common],
    kpis: ["reservations", "revenue", "repeat_guests"],
  },
  realestate: {
    key: "realestate", label: "Real estate",
    capabilities: ["products", "appointments"],
    terms: { customer: "Lead", item: "Listing", items: "Listings", order: "Deal", booking: "Viewing" },
    operationsFields: [{ key: "listings", label: "Listings", type: "list" }, ...common],
    kpis: ["leads", "viewings", "conversion"],
  },
  electronics: {
    key: "electronics", label: "Electronics",
    capabilities: ["products", "orders", "delivery", "inventory"],
    terms: { customer: "Customer", item: "Product", items: "Products", order: "Order", booking: "Booking" },
    operationsFields: [
      { key: "products", label: "Products, specs, prices & stock", type: "list" },
      { key: "warranty", label: "Warranty & returns", type: "textarea" },
      { key: "deliveryOptions", label: "Delivery options", type: "textarea" },
    ],
    kpis: ["orders", "revenue", "aov"],
  },
  healthcare: {
    key: "healthcare", label: "Healthcare & dental clinics",
    capabilities: ["services", "appointments"],
    terms: { customer: "Patient", item: "Service", items: "Services", order: "Order", booking: "Appointment" },
    operationsFields: [
      { key: "services", label: "Services & fees", type: "list" }, ...common,
      { key: "practitioners", label: "Practitioners", type: "list", hint: "One name per line" },
      { key: "cancellationPolicy", label: "Cancellation policy", type: "textarea" },
    ],
    kpis: ["bookings", "attendance", "repeat_patients"],
  },
  fitness: {
    key: "fitness", label: "Fitness & gyms",
    capabilities: ["services", "appointments"],
    terms: { customer: "Member", item: "Class / Plan", items: "Classes & Plans", order: "Order", booking: "Session" },
    operationsFields: [{ key: "plans", label: "Memberships, classes & prices", type: "list" }, ...common],
    kpis: ["bookings", "attendance", "retention"],
  },
  education: {
    key: "education", label: "Education",
    capabilities: ["services", "appointments"],
    terms: { customer: "Student", item: "Course", items: "Courses", order: "Enrollment", booking: "Session" },
    operationsFields: [{ key: "courses", label: "Courses, fees & schedules", type: "list" }, ...common],
    kpis: ["enquiries", "enrollments", "conversion"],
  },
  professional: {
    key: "professional", label: "Professional services",
    capabilities: ["services", "appointments"],
    terms: { customer: "Client", item: "Service", items: "Services", order: "Order", booking: "Consultation" },
    operationsFields: [{ key: "services", label: "Services & rates", type: "list" }, ...common],
    kpis: ["leads", "bookings", "conversion"],
  },
  other: {
    key: "other", label: "Other",
    capabilities: ["products", "services", "orders"],
    terms: { customer: "Customer", item: "Item", items: "Products & Services", order: "Order", booking: "Booking" },
    operationsFields: [
      { key: "describe", label: "Describe what you sell or offer", type: "textarea" },
      { key: "catalog", label: "Products / services & prices", type: "list" }, ...common,
    ],
    kpis: ["orders", "revenue", "leads"],
  },
};

export const getIndustry = (key?: string | null) => INDUSTRIES[key ?? "other"] ?? INDUSTRIES.other;

/** AI tools available given the org's enabled capabilities. */
export function toolsForCapabilities(caps: string[]): AiTool[] {
  const t = new Set<AiTool>(["get_customer_profile", "update_customer_profile", "create_customer_followup", "escalate_to_human"]);
  const has = (c: Capability) => caps.includes(c);
  if (has("products") || has("services") || has("menu")) { t.add("search_products"); t.add("get_product_details"); t.add("send_item_photos"); }
  if (has("inventory")) t.add("check_inventory");
  if (has("orders")) { t.add("create_order"); t.add("check_order_status"); t.add("send_payment_link"); }
  if (has("appointments") || has("reservations")) {
    (["check_appointment_availability", "book_appointment", "reschedule_appointment", "cancel_appointment"] as AiTool[]).forEach((x) => t.add(x));
  }
  return [...t];
}
