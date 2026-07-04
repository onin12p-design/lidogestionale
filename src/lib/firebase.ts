import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth and Firestore
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Connection verification helper
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    console.log("Firebase Firestore connected successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration: Client is offline.");
    }
  }
}

// Auto sign-in helper so that staff is always authenticated and compliant with rules
export function autoSignInStaff(onUserReady: (user: User) => void) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("User is authenticated:", user.uid);
      onUserReady(user);
    } else {
      console.log("No authenticated user, logging in anonymously...");
      try {
        const credential = await signInAnonymously(auth);
        console.log("Authenticated anonymously as:", credential.user.uid);
        onUserReady(credential.user);
      } catch (err) {
        console.warn("Failed to authenticate anonymously:", err);
      }
    }
  });
}

// Custom Operation Type and Firestore error handling according to specifications
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Anti double-booking transactional helper function (P1)
import { runTransaction } from "firebase/firestore";
import { Booking } from "../types";

export interface TransactionResult {
  success: boolean;
  booking?: Booking;
  error?: string;
}

export async function createBookingTransactional(booking: Omit<Booking, "id" | "createdAt">): Promise<TransactionResult> {
  const date = booking.date;
  const bed = booking.bedNumber;
  const slot = booking.slot;

  // Generate the document IDs for the 3 potential slots of this bed/date
  const morningId = `${date}_${bed}_morning`;
  const afternoonId = `${date}_${bed}_afternoon`;
  const fullDayId = `${date}_${bed}_full_day`;

  // Doc references
  const morningRef = doc(db, "bookings", morningId);
  const afternoonRef = doc(db, "bookings", afternoonId);
  const fullDayRef = doc(db, "bookings", fullDayId);

  try {
    const result = await runTransaction(db, async (transaction) => {
      // 1. Read all 3 documents
      const morningSnap = await transaction.get(morningRef);
      const afternoonSnap = await transaction.get(afternoonRef);
      const fullDaySnap = await transaction.get(fullDayRef);

      const hasMorning = morningSnap.exists();
      const hasAfternoon = afternoonSnap.exists();
      const hasFullDay = fullDaySnap.exists();

      // Get names of customers holding existing slots for description
      const morningName = hasMorning ? morningSnap.data()?.customerName || "Qualcuno" : "";
      const afternoonName = hasAfternoon ? afternoonSnap.data()?.customerName || "Qualcuno" : "";
      const fullDayName = hasFullDay ? fullDaySnap.data()?.customerName || "Qualcuno" : "";

      // 2. Compatibility rules check
      if (slot === "full_day") {
        if (hasFullDay) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Giornata Intera da ${fullDayName}`);
        }
        if (hasMorning) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Mattina da ${morningName}`);
        }
        if (hasAfternoon) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Pomeriggio da ${afternoonName}`);
        }
      } else if (slot === "morning") {
        if (hasFullDay) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Giornata Intera da ${fullDayName}`);
        }
        if (hasMorning) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Mattina da ${morningName}`);
        }
      } else if (slot === "afternoon") {
        if (hasFullDay) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Giornata Intera da ${fullDayName}`);
        }
        if (hasAfternoon) {
          throw new Error(`Lettino ${bed} già occupato per la fascia Pomeriggio da ${afternoonName}`);
        }
      }

      // 3. Write booking if compatible
      const targetId = `${date}_${bed}_${slot}`;
      const targetRef = doc(db, "bookings", targetId);

      const finalBooking: Booking = {
        id: targetId,
        bedNumber: bed,
        date: date,
        slot: slot,
        customerId: booking.customerId || "",
        customerName: booking.customerName,
        customerType: booking.customerType,
        subscriptionId: booking.subscriptionId || "",
        source: booking.source,
        notes: booking.notes || "",
        createdAt: new Date().toISOString()
      };

      transaction.set(targetRef, finalBooking);
      return finalBooking;
    });

    return { success: true, booking: result };
  } catch (err: any) {
    console.error("Transactional booking failed:", err.message);
    return { success: false, error: err.message };
  }
}
