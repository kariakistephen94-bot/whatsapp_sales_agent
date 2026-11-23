/** Wire types shared by the inbox API routes (server) and the inbox UI (client). Dates are ISO strings. */

export type ConvoFilter = "all" | "open" | "escalated" | "resolved";

export interface ConvoListItem {
  id: string;
  status: string; // open | escalated | resolved
  handler: "AI" | "HUMAN";
  lastMessageAt: string;
  customer: { id: string; name: string | null; phone: string };
  last: { body: string | null; sender: string; mediaType: string | null; createdAt: string } | null;
}

export interface ToolTraceView { name: string; summary: string }

export interface ThreadMessage {
  id: string;
  direction: string;
  sender: string; // customer | ai | human | system
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  status: string; // queued | sent | delivered | read | failed
  createdAt: string;
  tools: ToolTraceView[];
}

export interface ThreadNote { id: string; body: string; authorName: string; createdAt: string }

export interface ThreadCustomer {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  status: string;
  lifetimeValueCents: number;
  optedOut: boolean;
  preferences: string[];
  tags: { id: string; name: string }[];
}

export interface ThreadData {
  conversation: { id: string; status: string; handler: "AI" | "HUMAN"; assignedToId: string | null; lastMessageAt: string };
  customer: ThreadCustomer;
  messages: ThreadMessage[];
  notes: ThreadNote[];
  hasMore: boolean;
}

export const displayName = (c: { name: string | null; phone: string }) => c.name?.trim() || c.phone;
