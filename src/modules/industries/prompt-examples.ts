/**
 * Example prompts shown as placeholders in "Write with AI". They follow what the brand actually does:
 * identical for brands of the same kind (every cosmetics brand sees the same cosmetics examples),
 * different across kinds (solar companies see solar examples). Pure functions: safe on server and client.
 */
export type Brand = { name?: string; industryKey?: string | null; industryLabel?: string | null; businessType?: string | null; description?: string | null };

export type Topic = "solar" | "cosmetics" | "hair" | "fashion" | "food" | "hospitality" | "realestate" | "electronics" | "healthcare" | "fitness" | "education" | "professional" | "generic";
export type Slot = "items" | "staff" | "hours" | "delivery" | "policy" | "faqs" | "description" | "businessType" | "greeting" | "instructions" | "escalation" | "knowledge" | "itemDescription" | "storeDescription" | "automation" | "care";

const KEYWORDS: [Topic, RegExp][] = [
  ["solar", /\b(solar|inverter|photovoltaic|pv panel|lithium battery|power backup|renewable energy)/i],
  ["cosmetics", /\b(skin ?care|cosmetic|makeup|make-up|perfume|fragrance|fragnance|beauty|lotion|serum|body spray|oil|soap|glow)/i],
  ["hair", /\b(salon|barber|braid|hair|wig|lashes?|nails?)/i],
  ["fashion", /\b(fashion|cloth|dress|ankara|tailor|shoe|sneaker|bag|boutique|apparel|wear)/i],
  ["food", /\b(restaurant|food|cater|bakery|cake|pastry|kitchen|grill|chop|cafe|bar)/i],
  ["hospitality", /\b(hotel|guest ?house|apartment|shortlet|short-let|lodge|resort)/i],
  ["realestate", /\b(real ?estate|property|land|estate|realtor)/i],
  ["electronics", /\b(electronic|phone|laptop|gadget|appliance|computer)/i],
  ["healthcare", /\b(clinic|dental|dentist|hospital|pharmacy|health|medical)/i],
  ["fitness", /\b(gym|fitness|yoga|personal train)/i],
  ["education", /\b(school|course|training|academy|tutor|class(es)?|lesson)/i],
  ["professional", /\b(law|legal|account|consult|agency|architect|engineer)/i],
];
const BY_INDUSTRY: Record<string, Topic> = {
  beauty: "cosmetics", salon: "hair", fashion: "fashion", restaurant: "food", hospitality: "hospitality", realestate: "realestate",
  electronics: "electronics", healthcare: "healthcare", fitness: "fitness", education: "education", professional: "professional",
};

/** What the brand is, judged from what it says about itself first (name, what it offers), then its category. */
export function topicFor(b: Brand): Topic {
  const text = [b.name, b.businessType, b.description].filter(Boolean).join(" ");
  for (const [t, re] of KEYWORDS) if (re.test(text)) return t;
  if (b.industryKey && BY_INDUSTRY[b.industryKey]) return BY_INDUSTRY[b.industryKey];
  return "generic";
}

type Bank = Partial<Record<Slot, string>>;
const BANK: Record<Topic, Bank> = {
  solar: {
    items: "give me 8 packages and services a solar company offers, like installation, inverter and battery systems, and maintenance",
    hours: "e.g. we're open Monday to Friday 8 to 5 and Saturday 9 to 2",
    delivery: "e.g. we install nationwide; site survey is free within Uyo, outside Uyo the team will confirm",
    policy: "e.g. write a simple warranty and after-sales support policy for a solar company",
    faqs: "write 8 questions people ask a solar company, like what a system can power, battery backup, installation time and maintenance",
    description: "e.g. we design and install solar and battery backup for homes and businesses",
    knowledge: "e.g. explain how a free site survey and quotation works · what to say when someone asks how much a solar system costs",
    itemDescription: "e.g. describe this solar package: what it powers, what's included, who it suits",
    escalation: "e.g. hand over for large commercial projects, complaints about an installation, or any request for a firm price",
  },
  cosmetics: {
    items: "give me 10 products and services a regular skincare and beauty brand offers",
    hours: "e.g. normal opening hours for a skincare and beauty shop",
    delivery: "e.g. write simple delivery options for a small beauty brand: same-day in the city, courier nationwide",
    policy: "e.g. write a return and exchange policy for skincare and fragrance products",
    faqs: "write 8 common questions customers ask a skincare or perfume brand, like ingredients, skin types, authenticity, delivery and returns",
    description: "e.g. we sell skincare, perfumes and body care to women in Lagos with free delivery in the city",
    knowledge: "e.g. explain which products suit oily, dry or sensitive skin · our authenticity and return policy",
    itemDescription: "e.g. describe this product: what it is, who it suits, how to use it",
    escalation: "e.g. hand over for skin reactions or complaints, bulk or wholesale orders, and refund requests",
  },
  hair: {
    items: "give me 10 services a regular hair salon offers, with usual durations",
    hours: "e.g. normal opening hours for a hair salon, longer on Saturdays",
    delivery: "e.g. do we offer home service? write simple options for home visits and in-salon only",
    policy: "e.g. write a booking, deposit and cancellation policy for a hair salon",
    faqs: "write 8 questions customers ask a hair salon, like how long a style takes, deposits, lateness and what to bring",
    description: "e.g. we do braids, wigs and natural hair care in Lekki, by appointment",
    knowledge: "e.g. explain our deposit and lateness policy · how to prepare hair before a braiding appointment",
    itemDescription: "e.g. describe this hairstyle service: how long it takes, how long it lasts, hair needed",
    escalation: "e.g. hand over for complaints about a style, refunds, or bookings for large groups",
  },
  fashion: {
    items: "give me 10 products a regular fashion brand sells, with sizes and typical prices",
    hours: "e.g. normal opening hours for a fashion boutique",
    delivery: "e.g. write simple delivery options for a fashion brand: same-day in the city, courier to other states",
    policy: "e.g. write an exchange and return policy for clothing, including sizing and custom orders",
    faqs: "write 8 questions customers ask a fashion brand, like sizing, fabric, delivery time, exchanges and custom orders",
    description: "e.g. we sell ready-to-wear Ankara and corporate outfits for women, with custom sizing",
    knowledge: "e.g. explain our size chart and how to measure · custom order timelines",
    itemDescription: "e.g. describe this outfit: fabric, fit, sizes available, care",
    escalation: "e.g. hand over for wrong or damaged items, custom order disputes, and wholesale requests",
  },
  food: {
    items: "give me 12 dishes and drinks a regular Nigerian restaurant sells, with typical prices",
    hours: "e.g. normal opening hours for a restaurant, open late on weekends",
    delivery: "e.g. write simple delivery options for a restaurant: delivery areas, fee by distance, pickup available",
    policy: "e.g. write a reservation and order cancellation policy for a restaurant",
    faqs: "write 8 questions customers ask a restaurant, like delivery time, reservations, party orders and allergies",
    description: "e.g. we serve Nigerian dishes and grills, dine-in, takeaway and delivery",
    knowledge: "e.g. explain how party and bulk orders work · how long delivery takes",
    itemDescription: "e.g. describe this dish: what's in it, portion size, spice level",
    escalation: "e.g. hand over for food complaints, allergy questions, and large event bookings",
  },
  hospitality: {
    items: "give me 6 room types and services a regular hotel offers, with typical nightly rates",
    hours: "e.g. check-in from 2 pm, check-out by 12 noon, front desk open 24 hours",
    delivery: "e.g. do we offer airport pickup? write simple options and pricing guidance",
    policy: "e.g. write a booking, deposit and cancellation policy for a hotel",
    faqs: "write 8 questions guests ask a hotel, like check-in times, breakfast, parking, airport pickup and cancellations",
    description: "e.g. we're a comfortable hotel with a restaurant, parking and 24 hour power",
    knowledge: "e.g. explain our cancellation policy · what's included in the room rate",
    itemDescription: "e.g. describe this room: size, bed, what's included, who it suits",
    escalation: "e.g. hand over for group or event bookings, complaints during a stay, and refund requests",
  },
  realestate: {
    items: "give me 6 sample property listings a regular real estate agency might have, with locations and prices",
    hours: "e.g. normal office hours, with viewings by appointment on weekends",
    delivery: "e.g. explain how viewings are arranged and which areas we cover",
    policy: "e.g. write our inspection fee and agreement process in simple terms",
    faqs: "write 8 questions people ask a real estate agency, like documents, inspection, payment plans and agent fees",
    description: "e.g. we sell and rent homes and land in Uyo and nearby areas",
    knowledge: "e.g. explain how a property purchase works step by step · what documents buyers should expect",
    itemDescription: "e.g. describe this listing: location, size, features, what's nearby",
    escalation: "e.g. hand over for price negotiation, legal questions, and serious buyers ready to inspect",
  },
  electronics: {
    items: "give me 10 products a regular electronics shop sells, with typical prices and stock",
    hours: "e.g. normal opening hours for an electronics shop",
    delivery: "e.g. write simple delivery options for electronics: same-day in the city, insured courier nationwide",
    policy: "e.g. write a warranty and return policy for electronics",
    faqs: "write 8 questions customers ask an electronics shop, like warranty, original products, delivery and payment",
    description: "e.g. we sell phones, laptops and accessories with a one year warranty",
    knowledge: "e.g. explain our warranty claim process · how we verify products are original",
    itemDescription: "e.g. describe this product: key specs, what's in the box, warranty",
    escalation: "e.g. hand over for warranty claims, faulty items, and bulk or corporate orders",
  },
  healthcare: {
    items: "give me 10 services a regular clinic offers, with typical fees",
    hours: "e.g. normal opening hours for a clinic, with emergencies handled separately",
    delivery: "e.g. explain how appointments and walk-ins work and what to bring",
    policy: "e.g. write a cancellation and late arrival policy for a clinic",
    faqs: "write 8 questions patients ask a clinic, like booking, fees, insurance, what to bring and results",
    description: "e.g. we're a family clinic offering consultations, lab tests and dental care",
    knowledge: "e.g. explain how to prepare for a consultation · which insurance or HMOs we accept",
    itemDescription: "e.g. describe this service: what it involves, how long it takes, who it's for",
    escalation: "e.g. hand over for any medical emergency or symptoms, medical advice requests, and billing disputes",
  },
  fitness: {
    items: "give me 6 memberships and classes a regular gym offers, with typical prices",
    hours: "e.g. normal opening hours for a gym, early mornings and late evenings",
    delivery: "e.g. explain how to join, trial sessions and what to bring",
    policy: "e.g. write a membership freeze and cancellation policy for a gym",
    faqs: "write 8 questions people ask a gym, like membership types, trainers, trial sessions and freezing",
    description: "e.g. we're a gym with personal trainers, group classes and a clean, safe space",
    knowledge: "e.g. explain our membership plans · how personal training sessions work",
    itemDescription: "e.g. describe this plan or class: what's included, schedule, who it suits",
    escalation: "e.g. hand over for injuries, billing disputes, and corporate membership requests",
  },
  education: {
    items: "give me 6 courses a regular training school offers, with typical fees and durations",
    hours: "e.g. normal class and office hours, with weekend sessions",
    delivery: "e.g. explain how to enrol, payment plans and class formats (online or in person)",
    policy: "e.g. write a refund and deferral policy for a training school",
    faqs: "write 8 questions students ask a training school, like entry requirements, fees, schedules and certificates",
    description: "e.g. we run practical digital skills courses, online and in person",
    knowledge: "e.g. explain how enrolment works · what certificate students receive",
    itemDescription: "e.g. describe this course: what you'll learn, duration, who it's for",
    escalation: "e.g. hand over for refund requests, corporate training enquiries, and complaints",
  },
  professional: {
    items: "give me 8 services a regular consulting or professional services firm offers, with typical rates",
    hours: "e.g. normal office hours, with consultations by appointment",
    delivery: "e.g. explain how consultations work: in person, phone or video, and how to book",
    policy: "e.g. write a simple engagement and cancellation policy for a consulting firm",
    faqs: "write 8 questions prospective clients ask a professional services firm, like fees, timelines and what to prepare",
    description: "e.g. we provide accounting and business advisory services to small businesses",
    knowledge: "e.g. explain how an engagement works step by step · what we need from new clients",
    itemDescription: "e.g. describe this service: what's included, how long it takes, who it's for",
    escalation: "e.g. hand over for legal or tax advice questions, fee negotiation, and urgent matters",
  },
  generic: {},
};

const subject = (b: Brand) => (b.businessType?.trim() ? `a business that offers ${b.businessType.trim().toLowerCase()}` : `a regular ${(b.industryLabel?.trim() || "small business").toLowerCase()}`);

/** The placeholder for a given slot, specific to what this brand does. */
export function examplesFor(brand: Brand, slot: Slot): string {
  const topic = topicFor(brand);
  const hit = BANK[topic][slot];
  if (hit) return hit;
  const what = subject(brand);
  const name = brand.name?.trim() || "my business";
  switch (slot) {
    case "items": return `give me 10 products or services for ${what}, with typical prices`;
    case "staff": return "e.g. add the names of my team members who take bookings";
    case "hours": return `e.g. normal opening hours for ${what}`;
    case "delivery": return `e.g. write simple delivery or pickup options for ${what}`;
    case "policy": return `e.g. write a fair return and cancellation policy for ${what}`;
    case "faqs": return `write 8 questions customers commonly ask ${what}, with answers`;
    case "description": return `e.g. what ${name} sells or does, who for, and where`;
    case "businessType": return "e.g. say in a few words what the business sells or does";
    case "greeting": return `e.g. a warm greeting for ${name}`;
    case "instructions": return `e.g. what ${name}'s assistant should do, what it must never say, and how to handle price questions`;
    case "escalation": return `e.g. when ${what} should hand over to a person`;
    case "knowledge": return `e.g. write our delivery policy · what to say when someone asks about returns`;
    case "itemDescription": return "e.g. describe this item: what it is, key details, who it suits";
    case "storeDescription": return `e.g. a friendly intro to ${name} for the storefront`;
    case "automation": return `e.g. write a friendly message for ${name}`;
    case "care": return `e.g. a short, warm message inviting a past customer of ${name} to come back`;
  }
}
// Slots whose topic text above is a description, not a greeting or message, fall through to the generic wording for these:
// greeting / storeDescription / automation / care stay brand-name based on purpose.
export function slotFor(kind: "instructions" | "description" | "field", ctx?: Record<string, string>): Slot {
  if (kind === "instructions") return "instructions";
  if (kind === "description") return "description";
  const key = ctx?.fieldKey ?? "";
  const type = ctx?.fieldType ?? "";
  if (type === "hours") return "hours";
  if (type === "faq_list" || key === "faq" || key === "faqs") return "faqs";
  if (key === "businessType") return "businessType";
  if (key === "greeting") return "greeting";
  if (key === "escalation") return "escalation";
  if (key === "knowledge" || type === "entry") return "knowledge";
  if (key === "itemDescription") return "itemDescription";
  if (key === "storeDescription") return "storeDescription";
  if (key === "automation") return "automation";
  if (key === "careTemplate") return "care";
  if (/^(stylists|practitioners)$/.test(key)) return "staff";
  if (/delivery|pickup/i.test(key)) return "delivery";
  if (/policy|warranty/i.test(key)) return "policy";
  if (type === "list") return "items";
  return "knowledge";
}
