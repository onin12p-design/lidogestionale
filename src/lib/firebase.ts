import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, doc, getDocFromServer, collection, query, where, runTransaction, getDocs } from "firebase/firestore";
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
import { Booking } from "../types";
import { sanitizeForFirestore, getBedLettiniCount, getBedItems, hasConflict } from "../utils";

export interface TransactionResult {
  success: boolean;
  booking?: Booking;
  error?: string;
}

export async function createBookingTransactional(booking: Omit<Booking, "id" | "createdAt">): Promise<TransactionResult> {
  const date = booking.date;
  const bed = booking.bedNumber;
  const slot = booking.slot;

  try {
    // 1. Fetch all bookings for the specified date outside the transaction
    const bookingsQuery = query(
      collection(db, "bookings"),
      where("date", "==", date)
    );
    const bookingsSnap = await getDocs(bookingsQuery);

    // 2. Define our serialization lock for this date to prevent concurrent write anomalies (phantom reads)
    const lockRef = doc(db, "bookings_locks", date);

    const result = await runTransaction(db, async (transaction) => {
      // a. Read the lock document to force serialization of concurrent bookings on the same date
      await transaction.get(lockRef);

      // b. Read the beds configuration to resolve bed item counts dynamically
      const bedsConfigRef = doc(db, "settings", "beds");
      const bedsConfigSnap = await transaction.get(bedsConfigRef);
      const bedsConfig = bedsConfigSnap.exists() ? (bedsConfigSnap.data() as Record<number, number>) : {};

      // c. Transactionally read all existing bookings of the date we fetched
      const freshBookingSnaps = [];
      for (const d of bookingsSnap.docs) {
        freshBookingSnaps.push(await transaction.get(d.ref));
      }

      const existingBookings = freshBookingSnaps
        .filter((snap) => snap.exists())
        .map((snap) => ({ id: snap.id, ...snap.data() } as Booking));

      // d. Populate target resources of the new booking
      const numLettini = getBedLettiniCount(bed, bedsConfig);
      const defaultItems = getBedItems(bed, numLettini);
      const risorse = booking.risorse && booking.risorse.length > 0
        ? booking.risorse
        : [{ postazione: bed, items: defaultItems }];

      // e. Perform central conflict checks for each resource
      for (const res of risorse) {
        const bedNum = res.postazione;
        for (const item of res.items) {
          const itemBookings: any[] = [];
          
          existingBookings.forEach((eb) => {
            let ebItems: string[] = [];
            if (eb.risorse && eb.risorse.length > 0) {
              const ebRes = eb.risorse.find((r) => r.postazione === bedNum);
              if (ebRes) {
                ebItems = ebRes.items;
              }
            } else {
              // Legacy booking on the same bed: occupies all items
              if (eb.bedNumber === bedNum) {
                const ebNumLettini = getBedLettiniCount(bedNum, bedsConfig);
                ebItems = getBedItems(bedNum, ebNumLettini);
              }
            }
            if (ebItems.includes(item)) {
              itemBookings.push(eb);
            }
          });

          if (hasConflict(itemBookings, slot)) {
            throw new Error(`Conflitto sulla postazione ${bedNum}, risorsa '${item === 'ombrellone' ? 'ombrellone' : 'lettino'}' già occupata per la fascia selezionata.`);
          }
        }
      }

      // f. Write the new booking with a unique random document ID
      const targetId = doc(collection(db, "bookings")).id;
      const targetRef = doc(db, "bookings", targetId);

      const finalBooking: Booking = {
        id: targetId,
        bedNumber: bed,
        date: date,
        slot: slot,
        tipoPrenotazione: booking.tipoPrenotazione || "intera",
        risorse: risorse,
        customerId: booking.customerId || "",
        customerName: booking.customerName,
        customerType: booking.customerType,
        subscriptionId: booking.subscriptionId || "",
        source: booking.source,
        notes: booking.notes || "",
        createdAt: new Date().toISOString()
      };

      transaction.set(targetRef, sanitizeForFirestore(finalBooking));
      
      // Update lock to force serialization of successive transactions
      transaction.set(lockRef, { lastUpdated: new Date().toISOString() });

      return finalBooking;
    });

    return { success: true, booking: result };
  } catch (err: any) {
    console.error("Transactional booking failed:", err.message);
    return { success: false, error: err.message };
  }
}
