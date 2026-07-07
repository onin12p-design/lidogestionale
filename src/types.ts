export type CustomerType = "daily" | "subscriber";
export type BookingSlot = "morning" | "afternoon" | "full_day";
export type SubscriptionStatus = "active" | "expired" | "cancelled";
export type PaymentMethod = "cash" | "card";
export type PaymentKind = "full" | "deposit";
export type BookingSource = "manual" | "scanner" | "subscription";

export interface Customer {
  id?: string;
  name: string;
  phone?: string;
  type: CustomerType;
  notes?: string;
  dealType?: "seasonal" | "pay_per_day";
  createdAt?: any;
}

export interface LedgerEntry {
  id?: string;
  customerId: string;
  subscriptionId?: string; // optional, linked to a specific period
  kind: "payment" | "deposit" | "day_waiver_credit" | "daily_charge" | "adjustment";
  amount: number; // positive, kind determines the sign
  method?: PaymentMethod; // cash or card
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: any;
  createdBy?: string;
}

export interface Attendance {
  id: string; // date_customerId_bedNumber
  customerId: string;
  bedNumber: number;
  date: string; // YYYY-MM-DD
  slot: BookingSlot;
  status: "present" | "absent";
  chargeLedgerId?: string; // reference to the daily_charge ledger entry
}

export interface Subscription {
  id?: string;
  customerId: string; // reference to customer
  customerName?: string; // denormalized for easy lists
  customerPhone?: string;
  bedNumbers: number[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  slot: BookingSlot;
  daysOfWeek?: number[]; // [0,6]
  priceTotal: number;
  periodId?: string;
  slotTypeId?: string;
  priceMode?: "listino" | "concordato" | "da_concordare";
  agreedPrice?: number | null;
  status: SubscriptionStatus;
  notes?: string;
  createdAt?: string;
  pricingRule?: "standard" | "hotel_weekend";
  weekendRate?: number;
}

export type BookingTipoPrenotazione = "mattina" | "pomeriggio" | "intera" | "abbonato";

export const BOOKING_TYPE_COLORS = {
  free: "#E5E7EB",       // grigio chiaro
  mattina: "#FACC15",    // giallo
  pomeriggio: "#FB923C", // arancio
  intera: "#22C55E",     // verde
  abbonato: "#8B5CF6",   // viola
};

export interface RisorsaOccupata {
  postazione: number;
  items: string[]; // e.g. ["ombrellone", "lettino_1", "lettino_2"]
}

export interface Booking {
  id: string; // deterministic for legacy or random for new
  bedNumber: number;
  date: string; // YYYY-MM-DD
  slot: BookingSlot;
  tipoPrenotazione?: BookingTipoPrenotazione;
  risorse?: RisorsaOccupata[];
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerType: CustomerType;
  subscriptionId?: string;
  source: BookingSource;
  notes?: string;
  sconto?: number;
  isConfirmedPayPerDay?: boolean;
  dealType?: "seasonal" | "pay_per_day";
  isHotel?: boolean;
  hotelPaymentStatus?: string;
  createdAt: any; // Timestamp or ISO string
}

export interface Payment {
  id?: string;
  customerId?: string;
  subscriptionId?: string;
  bookingId?: string;
  amount: number;
  method: PaymentMethod;
  kind: PaymentKind;
  date: any; // timestamp
  operator?: string;
  dateStr?: string;
}

export interface TabItem {
  label: string;
  price: number;
  qty: number;
}

export interface Tab {
  id: string; // same as bookingId or customized
  bookingId: string;
  bedNumber: number;
  date: string; // YYYY-MM-DD
  items: TabItem[];
  paid: boolean;
  paidMethod?: PaymentMethod;
}
