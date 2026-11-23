/* Row types for every table. Hand-maintained: update alongside new supabase/*.sql files. */

export type Json = any;

export type Role = "OWNER" | "ADMIN" | "STAFF";
export const Role = { OWNER: "OWNER", ADMIN: "ADMIN", STAFF: "STAFF" } as const;
export type OrgStatus = "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export const OrgStatus = { TRIAL: "TRIAL", ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", CANCELLED: "CANCELLED" } as const;
export type ItemKind = "PRODUCT" | "SERVICE" | "MENU_ITEM";
export const ItemKind = { PRODUCT: "PRODUCT", SERVICE: "SERVICE", MENU_ITEM: "MENU_ITEM" } as const;
export type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "COMPLETED" | "CANCELLED";
export const OrderStatus = { PENDING: "PENDING", CONFIRMED: "CONFIRMED", PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" } as const;
export type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";
export const PaymentStatus = { UNPAID: "UNPAID", PENDING: "PENDING", PAID: "PAID", REFUNDED: "REFUNDED" } as const;
export type HandlerMode = "AI" | "HUMAN";
export const HandlerMode = { AI: "AI", HUMAN: "HUMAN" } as const;

export type User = {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  createdAt: Date;
};
export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  industry: string | null;
  industryTemplateKey: string | null;
  description: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  socialLinks: Json | null;
  timezone: string;
  currency: string;
  capabilities: string[];
  businessType: string | null;
  operations: Json | null;
  businessHours: Json | null;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
};
export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  invitedById: string;
  acceptedAt: Date | null;
  createdAt: Date;
  phone: string | null;
  token: string | null;
  expiresAt: Date | null;
  authUserId: string | null;
};
export type Membership = {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
  createdAt: Date;
  phone: string | null;
  notifyHandoffs: boolean;
};
export type Plan = {
  id: string;
  key: string;
  name: string;
  priceCents: number;
  currency: string;
  limits: Json;
  features: string[];
  active: boolean;
};
export type Subscription = {
  id: string;
  organizationId: string;
  planId: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  gatewayCustomerId: string | null;
  gatewaySubscriptionId: string | null;
};
export type PaymentConfig = { organizationId: string; provider: string; publicKey: string; secretEncrypted: string; mode: string; createdAt: Date; updatedAt: Date };
export type OrderPayment = { id: string; organizationId: string; orderId: string; reference: string; amountCents: number; currency: string; status: string; authorizationUrl: string | null; createdAt: Date; paidAt: Date | null };
export type BillingTransaction = {
  id: string;
  organizationId: string;
  planId: string;
  reference: string;
  amountCents: number;
  currency: string;
  status: string;
  gateway: string;
  gatewayPayload: Json | null;
  createdAt: Date;
  paidAt: Date | null;
};
export type UsageCounter = {
  id: string;
  organizationId: string;
  metric: string;
  period: string;
  count: number;
};
export type AiAgent = {
  id: string;
  organizationId: string;
  name: string;
  avatarUrl: string | null;
  personality: string;
  tone: string;
  language: string;
  formality: string;
  responseLength: string;
  greeting: string | null;
  salesStrategy: string | null;
  instructions: string | null;
  escalationRules: Json | null;
  workingHours: Json | null;
  enabledTools: string[];
  model: string | null;
  active: boolean;
};
export type KnowledgeSource = {
  id: string;
  organizationId: string;
  type: string;
  title: string;
  content: string | null;
  url: string | null;
  fileKey: string | null;
  verified: boolean;
  createdAt: Date;
};
export type KnowledgeChunk = {
  id: string;
  organizationId: string;
  sourceId: string;
  content: string;
  embedding: Json | null;
};
export type CatalogItem = {
  id: string;
  organizationId: string;
  kind: ItemKind;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  durationMins: number | null;
  trackInventory: boolean;
  stock: number | null;
  variants: Json | null;
  images: string[];
  category: string | null;
  active: boolean;
  createdAt: Date;
};
export type Customer = {
  id: string;
  organizationId: string;
  phone: string;
  name: string | null;
  email: string | null;
  status: string;
  preferences: Json | null;
  notes: string | null;
  insights: string | null;
  lifetimeValueCents: number;
  optedOut: boolean;
  consentAt: Date | null;
  assignedToId: string | null;
  lastInteractionAt: Date | null;
  source: string;
  createdAt: Date;
  relationship: string;
  lastPurchaseAt: Date | null;
  nextBookingAt: Date | null;
  visitCount: number;
  avgGapDays: number | null;
  expectedNextAt: Date | null;
  lastNudgedAt: Date | null;
  nudgeCount: number;
  nextNudgeAt: Date | null;
  relationshipUpdatedAt: Date | null;
};
export type Tag = {
  id: string;
  organizationId: string;
  name: string;
  color: string | null;
};
export type CustomerTag = {
  customerId: string;
  tagId: string;
};
export type Segment = {
  id: string;
  organizationId: string;
  name: string;
  system: boolean;
  rules: Json;
};
export type Followup = {
  id: string;
  organizationId: string;
  customerId: string;
  dueAt: Date;
  reason: string;
  message: string | null;
  conversationId: string | null;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
};
export type Order = {
  id: string;
  organizationId: string;
  customerId: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  delivery: Json | null;
  source: string;
  conversationId: string | null;
  createdByAi: boolean;
  paymentMethod: string | null;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
};
export type OrderItem = {
  id: string;
  orderId: string;
  itemId: string;
  name: string;
  quantity: number;
  unitCents: number;
  variant: Json | null;
};
export type StaffMember = {
  id: string;
  organizationId: string;
  name: string;
  role: string | null;
  workingHours: Json;
  serviceIds: string[];
  active: boolean;
};
export type Appointment = {
  id: string;
  organizationId: string;
  customerId: string;
  serviceId: string;
  staffId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  createdByAi: boolean;
  source: string;
  notes: string | null;
  conversationId: string | null;
};
export type ReminderLog = {
  id: string;
  appointmentId: string;
  kind: string;
  status: string;
  sentAt: Date | null;
};
export type WhatsappConnection = {
  id: string;
  organizationId: string;
  provider: string;
  label: string | null;
  status: string;
  phoneNumber: string | null;
  credsEncrypted: string | null;
  qr: string | null;
  lastError: string | null;
  desiredState: string;
  lastSeenAt: Date | null;
};
export type Conversation = {
  id: string;
  organizationId: string;
  customerId: string;
  connectionId: string;
  status: string;
  handler: HandlerMode;
  assignedToId: string | null;
  lastMessageAt: Date;
};
export type Message = {
  id: string;
  organizationId: string;
  conversationId: string;
  externalId: string;
  direction: string;
  sender: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  status: string;
  meta: Json | null;
  createdAt: Date;
};
export type ConversationNote = {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
};
export type Automation = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  trigger: string;
  config: Json;
  enabled: boolean;
  sentCount: number;
};
export type Storefront = {
  id: string;
  organizationId: string;
  published: boolean;
  name: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string;
  description: string | null;
  settings: Json | null;
};
export type DashboardPreference = {
  id: string;
  userId: string;
  organizationId: string;
  layout: Json;
};
export type AuditLog = {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: Json | null;
  createdAt: Date;
};
export type Job = {
  id: string;
  queue: string;
  name: string;
  key: string | null;
  data: Json;
  runAt: Date;
  status: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type RateLimitBucket = {
  key: string;
  count: number;
  resetAt: Date;
};
export type WorkerHeartbeat = {
  id: string;
  beatAt: Date;
};

/** Timestamp columns: converted from ISO strings to Date when rows come back from Supabase. */
export const DATE_COLUMNS = new Set(["expiresAt", "acceptedAt", "beatAt", "consentAt", "createdAt", "currentPeriodEnd", "dueAt", "endsAt", "lastInteractionAt", "lastPurchaseAt", "nextBookingAt", "expectedNextAt", "lastNudgedAt", "nextNudgeAt", "relationshipUpdatedAt", "lastMessageAt", "lastSeenAt", "lockedAt", "onboardingCompletedAt", "paidAt", "resetAt", "runAt", "sentAt", "startsAt", "trialEndsAt", "updatedAt"]);
/** JSON columns: their contents are left untouched by the date conversion. */
export const JSON_COLUMNS = new Set(["businessHours", "config", "data", "delivery", "embedding", "escalationRules", "gatewayPayload", "layout", "limits", "meta", "operations", "preferences", "rules", "settings", "socialLinks", "variant", "variants", "workingHours"]);
export const TABLES = ["User", "Organization", "Invitation", "Membership", "Plan", "Subscription", "UsageCounter", "AiAgent", "KnowledgeSource", "KnowledgeChunk", "CatalogItem", "Customer", "Tag", "CustomerTag", "Segment", "Followup", "Order", "OrderItem", "StaffMember", "Appointment", "ReminderLog", "WhatsappConnection", "Conversation", "Message", "ConversationNote", "Automation", "Storefront", "DashboardPreference", "AuditLog", "Job", "RateLimitBucket", "WorkerHeartbeat", "BillingTransaction", "PaymentConfig", "OrderPayment"] as const;
export type TableName = (typeof TABLES)[number];
