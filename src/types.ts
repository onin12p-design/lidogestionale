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
}

export interface Subscription {
  id?: string;
  customerId: string; // reference to customer
  customerName?: string; // denormalized for easy lists
  bedNumbers: number[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  slot: BookingSlot;
  daysOfWeek?: number[]; // [0,6]
  priceTotal: number;
  status: SubscriptionStatus;
  notes?: string;
}

export interface Booking {
  id: string; // deterministic: YYYY-MM-DD_bedNumber_slot (e.g. 2026-07-04_12_morning)
  bedNumber: number;
  date: string; // YYYY-MM-DD
  slot: BookingSlot;
  customerId?: string;
  customerName: string;
  customerType: CustomerType;
  subscriptionId?: string;
  source: BookingSource;
  notes?: string;
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
