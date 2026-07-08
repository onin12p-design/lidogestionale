import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import {
  getFirestore as realGetFirestore,
  doc as realDoc,
  getDocFromServer as realGetDocFromServer,
  collection as realCollection,
  query as realQuery,
  where as realWhere,
  runTransaction as realRunTransaction,
  getDocs as realGetDocs,
  setDoc as realSetDoc,
  deleteDoc as realDeleteDoc,
  addDoc as realAddDoc,
  writeBatch as realWriteBatch,
  onSnapshot as realOnSnapshot
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { Booking } from "../types";
import { sanitizeForFirestore, getBedLettiniCount, getBedItems, hasConflict } from "../utils";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);
export const db = realGetFirestore(app, firebaseConfig.firestoreDatabaseId);

// ----------------- LOCALSTORAGE FALLBACK ENGINE -----------------
const DB_PREFIX = "samarinda_db_";

export const offlineModeState = {
  active: localStorage.getItem("samarinda_offline_forced") === "true",
  quotaExceeded: false,
  listeners: [] as (() => void)[],
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  },
  notify() {
    this.listeners.forEach((l) => l());
  },
  setOffline(active: boolean, quota = false) {
    this.active = active;
    this.quotaExceeded = quota;
    localStorage.setItem("samarinda_offline_forced", active ? "true" : "false");
    this.notify();
  }
};

export function getLocalCollection(collectionName: string): any[] {
  try {
    const raw = localStorage.getItem(`${DB_PREFIX}${collectionName}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`Error reading local collection ${collectionName}:`, err);
  }

  // Pre-seed default configuration documents if empty
  if (collectionName === "settings") {
    const defaultSettings = [
      {
        id: "rows",
        "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 1, "9": 1, "10": 1,
        "11": 2, "12": 2, "13": 2, "14": 2, "15": 2, "16": 2, "17": 2, "18": 2, "19": 2, "20": 2,
        "21": 3, "22": 3, "23": 3, "24": 3, "25": 3, "26": 3, "27": 3, "28": 3, "29": 3, "30": 3,
        "60": 1, "61": 1, "62": 1, "63": 1, "64": 1, "65": 1, "66": 1, "67": 1, "68": 1, "69": 1, "70": 1,
        "71": 2, "72": 2, "73": 2, "74": 2, "75": 2, "76": 2, "77": 2, "78": 2, "79": 2, "80": 2, "81": 2,
        "82": 3, "83": 3, "84": 3, "85": 3, "86": 3, "87": 3, "88": 3, "89": 3, "90": 3, "91": 3, "92": 3,
        "31": 4, "32": 4, "33": 4, "34": 4,
        "93": 4, "94": 4, "95": 4, "96": 4, "97": 4, "98": 4, "99": 4, "100": 4, "101": 4, "102": 4, "103": 4,
        "104": 5, "105": 5, "106": 5, "107": 5, "108": 5, "109": 5
      },
      {
        id: "beds"
      }
    ];
    localStorage.setItem(`${DB_PREFIX}settings`, JSON.stringify(defaultSettings));
    return defaultSettings;
  }

  if (collectionName === "config") {
    const defaultConfig = [
      {
        id: "subscriptionSetup",
        periods: [
          { id: "stagionale", label: "Stagionale", dateStart: "2026-06-01", dateEnd: "2026-09-15", active: true },
          { id: "giugno-luglio", label: "Giugno + Luglio", dateStart: "2026-06-01", dateEnd: "2026-07-31", active: true }
        ],
        slotTypes: [
          { id: "1lig", code: "1LIG", label: "1 Lettino Intera Giornata", active: true },
          { id: "2lig", code: "2LIG", label: "2 Lettini Intera Giornata", active: true }
        ]
      },
      {
        id: "priceList",
        entries: [
          { periodId: "stagionale", slotTypeId: "2lig", price: 1200 },
          { periodId: "stagionale", slotTypeId: "1lig", price: 750 },
          { periodId: "giugno-luglio", slotTypeId: "2lig", price: 800 },
          { periodId: "giugno-luglio", slotTypeId: "1lig", price: 500 }
        ]
      }
    ];
    localStorage.setItem(`${DB_PREFIX}config`, JSON.stringify(defaultConfig));
    return defaultConfig;
  }

  return [];
}

export function setLocalCollection(collectionName: string, data: any[]) {
  try {
    localStorage.setItem(`${DB_PREFIX}${collectionName}`, JSON.stringify(data));
  } catch (err) {
    console.error(`Error writing local collection ${collectionName}:`, err);
  }
}

export function setLocalDoc(collectionName: string, docId: string, data: any) {
  const list = getLocalCollection(collectionName);
  const index = list.findIndex((item) => item.id === docId);
  const updatedDoc = { id: docId, ...data };
  if (index !== -1) {
    list[index] = updatedDoc;
  } else {
    list.push(updatedDoc);
  }
  setLocalCollection(collectionName, list);
}

export function parsePath(path: string) {
  const parts = path.split("/");
  if (parts.length === 2) {
    return { isDoc: true, collection: parts[0], docId: parts[1] };
  } else if (parts.length === 1) {
    return { isDoc: false, collection: parts[0], docId: null };
  } else {
    return { isDoc: true, collection: parts[0], docId: parts.slice(1).join("_") };
  }
}

const localListeners = new Set<{
  path: string;
  refOrQuery: any;
  callback: (snapshot: any) => void;
}>();

export function notifyLocalListeners(collectionName: string) {
  localListeners.forEach((listener) => {
    if (listener.path === collectionName || listener.path.startsWith(`${collectionName}/`)) {
      const snap = getLocalSnapshot(listener.refOrQuery);
      listener.callback(snap);
    }
  });
}

class LocalQueryDocumentSnapshot {
  constructor(public id: string, private _data: any) {}
  data() { return this._data; }
  get(field: string) { return this._data?.[field]; }
  exists() { return true; }
}

class LocalQuerySnapshot {
  docs: LocalQueryDocumentSnapshot[];
  constructor(docs: LocalQueryDocumentSnapshot[]) {
    this.docs = docs;
  }
  get size() { return this.docs.length; }
  get empty() { return this.docs.length === 0; }
  forEach(callback: (doc: LocalQueryDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

class LocalDocumentSnapshot {
  id: string;
  private _data: any;
  constructor(id: string, data: any) {
    this.id = id;
    this._data = data;
  }
  exists() { return this._data !== undefined && this._data !== null; }
  data() { return this._data; }
  get(field: string) { return this._data?.[field]; }
}

export function getLocalSnapshot(queryOrRef: any) {
  const path = queryOrRef.path;
  const parsed = parsePath(path);

  if (parsed.isDoc) {
    const list = getLocalCollection(parsed.collection);
    const docData = list.find((item) => item.id === parsed.docId);
    return new LocalDocumentSnapshot(parsed.docId!, docData);
  } else {
    let list = getLocalCollection(parsed.collection);
    if (queryOrRef._isQuery && queryOrRef.constraints) {
      queryOrRef.constraints.forEach((c: any) => {
        const { field, operator, value } = c;
        if (operator === "==") {
          list = list.filter((item) => item[field] === value);
        } else if (operator === ">=") {
          list = list.filter((item) => item[field] >= value);
        } else if (operator === "<=") {
          list = list.filter((item) => item[field] <= value);
        }
      });
    }
    const docSnaps = list.map((item) => new LocalQueryDocumentSnapshot(item.id, item));
    return new LocalQuerySnapshot(docSnaps);
  }
}

// ----------------- FIRESTORE API MOCK / FALLBACKS -----------------

export function getFirestore(appInstance: any, databaseId?: string) {
  return realGetFirestore(appInstance, databaseId);
}

export function collection(dbInstance: any, path: string) {
  const realCol = !offlineModeState.active ? realCollection(dbInstance, path) : null;
  return {
    path,
    _realRef: realCol,
    _isCollection: true
  };
}

export function doc(dbInstance: any, path?: string, ...pathSegments: string[]) {
  let fullPath = "";
  let id = "";

  if (dbInstance && dbInstance._isCollection) {
    if (path) {
      fullPath = dbInstance.path + "/" + path;
      id = path;
    } else {
      const generatedId = Math.random().toString(36).substring(2, 15);
      fullPath = dbInstance.path + "/" + generatedId;
      id = generatedId;
    }
  } else {
    fullPath = path || "";
    if (pathSegments.length > 0) {
      fullPath = fullPath + "/" + pathSegments.join("/");
    }
    const parsed = parsePath(fullPath);
    id = parsed.docId || "";
  }

  const parsed = parsePath(fullPath);
  const realDocRef = !offlineModeState.active ? realDoc(db, parsed.collection, parsed.docId!) : null;

  return {
    path: fullPath,
    id: id,
    _realRef: realDocRef,
    _isDoc: true
  };
}

export function query(collectionRef: any, ...constraints: any[]) {
  return {
    path: collectionRef.path,
    collectionRef,
    constraints,
    _isQuery: true
  };
}

export function where(field: string, operator: string, value: any) {
  return { field, operator, value, _isConstraint: true };
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export async function setDoc(docRef: any, data: any, options?: any) {
  const path = docRef.path;
  const parsed = parsePath(path);

  // Write-through to localStorage
  if (parsed.isDoc) {
    const list = getLocalCollection(parsed.collection);
    const index = list.findIndex((item) => item.id === parsed.docId);
    let updatedDoc = { ...data };
    if (options?.merge && index !== -1) {
      updatedDoc = { ...list[index], ...data };
    }
    updatedDoc.id = parsed.docId;

    if (index !== -1) {
      list[index] = updatedDoc;
    } else {
      list.push(updatedDoc);
    }
    setLocalCollection(parsed.collection, list);
    notifyLocalListeners(parsed.collection);
  }

  if (!offlineModeState.active) {
    try {
      const targetRef = docRef._realRef || realDoc(db, parsed.collection, parsed.docId!);
      await realSetDoc(targetRef, data, options);
    } catch (err: any) {
      console.warn(`Real setDoc failed for path "${path}":`, err);
      if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
        offlineModeState.setOffline(true, true);
      }
    }
  }
}

export async function addDoc(colRef: any, data: any) {
  const path = colRef.path;
  const generatedId = Math.random().toString(36).substring(2, 15);

  const docRef = {
    path: `${path}/${generatedId}`,
    id: generatedId,
    _isLocal: true
  };

  // Write-through to localStorage
  const list = getLocalCollection(path);
  const newDoc = { id: generatedId, ...data };
  list.push(newDoc);
  setLocalCollection(path, list);
  notifyLocalListeners(path);

  if (!offlineModeState.active) {
    try {
      const targetColRef = colRef._realRef || realCollection(db, path);
      const realDocRef = await realAddDoc(targetColRef, data);
      return realDocRef;
    } catch (err: any) {
      console.warn(`Real addDoc failed for path "${path}":`, err);
      if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
        offlineModeState.setOffline(true, true);
      }
    }
  }

  return docRef;
}

export async function deleteDoc(docRef: any) {
  const path = docRef.path;
  const parsed = parsePath(path);

  if (parsed.isDoc) {
    const list = getLocalCollection(parsed.collection);
    const updated = list.filter((item) => item.id !== parsed.docId);
    setLocalCollection(parsed.collection, updated);
    notifyLocalListeners(parsed.collection);
  }

  if (!offlineModeState.active) {
    try {
      const targetRef = docRef._realRef || realDoc(db, parsed.collection, parsed.docId!);
      await realDeleteDoc(targetRef);
    } catch (err: any) {
      console.warn(`Real deleteDoc failed for path "${path}":`, err);
      if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
        offlineModeState.setOffline(true, true);
      }
    }
  }
}

export async function getDocs(queryOrRef: any) {
  const path = queryOrRef.path;

  if (!offlineModeState.active) {
    try {
      let firebaseQuery = queryOrRef._realRef;
      if (queryOrRef._isQuery) {
        const colRef = realCollection(db, queryOrRef.path);
        const realConstraints = queryOrRef.constraints.map((c: any) => {
          return realWhere(c.field, c.operator, c.value);
        });
        firebaseQuery = realQuery(colRef, ...realConstraints);
      } else if (!firebaseQuery) {
        firebaseQuery = realCollection(db, path);
      }

      const snap = await realGetDocs(firebaseQuery);
      return snap;
    } catch (err: any) {
      console.warn(`Real getDocs failed for path "${path}":`, err);
      if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
        offlineModeState.setOffline(true, true);
      }
    }
  }

  return getLocalSnapshot(queryOrRef);
}

export function writeBatch(databaseInstance: any) {
  const realBatch = !offlineModeState.active ? realWriteBatch(databaseInstance) : null;
  const localOps: (() => void)[] = [];
  const modifiedCollections = new Set<string>();

  return {
    set(docRef: any, data: any, options?: any) {
      if (realBatch) {
        const realRef = docRef._realRef || realDoc(databaseInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
        realBatch.set(realRef, data, options);
      }
      localOps.push(() => {
        const parsed = parsePath(docRef.path);
        if (parsed.isDoc) {
          modifiedCollections.add(parsed.collection);
          const list = getLocalCollection(parsed.collection);
          const index = list.findIndex((item) => item.id === parsed.docId);
          let updatedDoc = { ...data };
          if (options?.merge && index !== -1) {
            updatedDoc = { ...list[index], ...data };
          }
          updatedDoc.id = parsed.docId;
          if (index !== -1) {
            list[index] = updatedDoc;
          } else {
            list.push(updatedDoc);
          }
          setLocalCollection(parsed.collection, list);
        }
      });
    },
    delete(docRef: any) {
      if (realBatch) {
        const realRef = docRef._realRef || realDoc(databaseInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
        realBatch.delete(realRef);
      }
      localOps.push(() => {
        const parsed = parsePath(docRef.path);
        if (parsed.isDoc) {
          modifiedCollections.add(parsed.collection);
          const list = getLocalCollection(parsed.collection);
          const updated = list.filter((item) => item.id !== parsed.docId);
          setLocalCollection(parsed.collection, updated);
        }
      });
    },
    async commit() {
      // Local operations first so the UI updates with zero-latency
      localOps.forEach((op) => op());
      modifiedCollections.forEach((col) => notifyLocalListeners(col));

      if (realBatch) {
        try {
          await realBatch.commit();
        } catch (err: any) {
          console.warn("Real writeBatch commit failed:", err);
          if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
            offlineModeState.setOffline(true, true);
          } else {
            throw err;
          }
        }
      }
    }
  };
}

export function onSnapshot(
  refOrQuery: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
) {
  const path = refOrQuery.path || (refOrQuery.collectionRef ? refOrQuery.collectionRef.path : "");
  let unsubscribing = false;
  let firebaseUnsubscribe: (() => void) | null = null;

  if (!offlineModeState.active) {
    try {
      let targetRef = refOrQuery._realRef;
      if (refOrQuery._isQuery) {
        const colRef = realCollection(db, refOrQuery.path);
        const realConstraints = refOrQuery.constraints.map((c: any) => {
          return realWhere(c.field, c.operator, c.value);
        });
        targetRef = realQuery(colRef, ...realConstraints);
      } else if (!targetRef) {
        const parsed = parsePath(path);
        if (parsed.isDoc) {
          targetRef = realDoc(db, parsed.collection, parsed.docId!);
        } else {
          targetRef = realCollection(db, path);
        }
      }

      firebaseUnsubscribe = realOnSnapshot(
        targetRef,
        (snapshot) => {
          if (unsubscribing) return;

          // Cache state locally (write-through)
          const parsed = parsePath(path);
          if (parsed.isDoc) {
            if (snapshot.exists()) {
              setLocalDoc(parsed.collection, parsed.docId!, snapshot.data());
            }
          } else {
            const list: any[] = [];
            snapshot.forEach((doc: any) => {
              list.push({ id: doc.id, ...doc.data() });
            });
            setLocalCollection(parsed.collection, list);
          }

          onNext(snapshot);
        },
        (error) => {
          if (unsubscribing) return;
          console.warn(`Firestore snapshot error for path "${path}":`, error);
          if (
            error.message?.includes("Quota exceeded") ||
            error.code === "resource-exhausted" ||
            error.message?.includes("Quota limit exceeded")
          ) {
            offlineModeState.setOffline(true, true);
            triggerLocalFallback();
          } else {
            if (onError) onError(error);
          }
        }
      );
    } catch (err) {
      console.warn("Error starting real onSnapshot, falling back to local:", err);
      offlineModeState.setOffline(true, false);
      triggerLocalFallback();
    }
  } else {
    setTimeout(() => {
      if (!unsubscribing) triggerLocalFallback();
    }, 0);
  }

  function triggerLocalFallback() {
    if (unsubscribing) return;

    const listener = {
      path,
      refOrQuery,
      callback: (data: any) => {
        if (unsubscribing) return;
        onNext(data);
      }
    };

    localListeners.add(listener);

    const currentData = getLocalSnapshot(refOrQuery);
    onNext(currentData);
  }

  return () => {
    unsubscribing = true;
    if (firebaseUnsubscribe) {
      firebaseUnsubscribe();
    }
    localListeners.forEach((l) => {
      if (l.path === path && l.refOrQuery === refOrQuery && l.callback === onNext) {
        localListeners.delete(l);
      }
    });
  };
}

export async function getDocFromServer(docRef: any) {
  if (!offlineModeState.active) {
    try {
      const parsed = parsePath(docRef.path);
      const realRef = docRef._realRef || realDoc(db, parsed.collection, parsed.docId!);
      const snap = await realGetDocFromServer(realRef);
      return snap;
    } catch (err) {
      console.warn("getDocFromServer failed, using local fallback:", err);
    }
  }
  const parsed = parsePath(docRef.path);
  const list = getLocalCollection(parsed.collection);
  const data = list.find((item) => item.id === parsed.docId);
  return new LocalDocumentSnapshot(parsed.docId!, data);
}

export async function runTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
  if (!offlineModeState.active) {
    try {
      const realResult = await realRunTransaction(dbInstance, async (realTx) => {
        const wrappedTx = {
          async get(docRef: any) {
            const realRef = docRef._realRef || realDoc(dbInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
            const snap = await realTx.get(realRef);
            return snap;
          },
          set(docRef: any, data: any, options?: any) {
            const realRef = docRef._realRef || realDoc(dbInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
            realTx.set(realRef, data, options);
          },
          update(docRef: any, data: any) {
            const realRef = docRef._realRef || realDoc(dbInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
            realTx.update(realRef, data);
          },
          delete(docRef: any) {
            const realRef = docRef._realRef || realDoc(dbInstance, parsePath(docRef.path).collection, parsePath(docRef.path).docId!);
            realTx.delete(realRef);
          }
        };
        return await updateFunction(wrappedTx);
      });
      return realResult;
    } catch (err: any) {
      console.warn("Real transaction failed:", err);
      if (err.message?.includes("Quota exceeded") || err.code === "resource-exhausted" || err.message?.includes("Quota limit exceeded")) {
        offlineModeState.setOffline(true, true);
      } else {
        throw err;
      }
    }
  }

  // Local Transaction Fallback
  const localTx = {
    async get(docRef: any) {
      const parsed = parsePath(docRef.path);
      const list = getLocalCollection(parsed.collection);
      const docData = list.find((item) => item.id === parsed.docId);
      return {
        exists() { return docData !== undefined; },
        data() { return docData; },
        id: parsed.docId || ""
      };
    },
    set(docRef: any, data: any, options?: any) {
      const parsed = parsePath(docRef.path);
      if (parsed.isDoc) {
        const list = getLocalCollection(parsed.collection);
        const index = list.findIndex((item) => item.id === parsed.docId);
        let updatedDoc = { ...data };
        if (options?.merge && index !== -1) {
          updatedDoc = { ...list[index], ...data };
        }
        updatedDoc.id = parsed.docId;
        if (index !== -1) {
          list[index] = updatedDoc;
        } else {
          list.push(updatedDoc);
        }
        setLocalCollection(parsed.collection, list);
        notifyLocalListeners(parsed.collection);
      }
    },
    update(docRef: any, data: any) {
      this.set(docRef, data, { merge: true });
    },
    delete(docRef: any) {
      const parsed = parsePath(docRef.path);
      if (parsed.isDoc) {
        const list = getLocalCollection(parsed.collection);
        const updated = list.filter((item) => item.id !== parsed.docId);
        setLocalCollection(parsed.collection, updated);
        notifyLocalListeners(parsed.collection);
      }
    }
  };

  return await updateFunction(localTx);
}

// ----------------- STANDARD FIREBASE UTILS (STABLE) -----------------

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
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
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
    // 1. Define our bookingsQuery
    const bookingsQuery = query(
      collection(db, "bookings"),
      where("date", "==", date)
    );

    const bookingsSnap = await getDocs(bookingsQuery);

    const lockRef = doc(db, "bookings_locks", date);

    const result = await runTransaction(db, async (transaction) => {
      // Force read serialization or mock read
      await transaction.get(lockRef);

      const bedsConfigRef = doc(db, "settings", "beds");
      const bedsConfigSnap = await transaction.get(bedsConfigRef);
      const bedsConfig = bedsConfigSnap.exists() ? (bedsConfigSnap.data() as Record<number, number>) : {};

      const freshBookingSnaps = [];
      // Ensure we query document collections
      if (bookingsSnap && (bookingsSnap as any).docs) {
        for (const d of (bookingsSnap as any).docs) {
          const freshRef = doc(db, "bookings", d.id);
          freshBookingSnaps.push(await transaction.get(freshRef));
        }
      }

      const existingBookings = freshBookingSnaps
        .filter((snap) => snap.exists())
        .map((snap) => ({ id: snap.id, ...snap.data() } as Booking));

      const numLettini = getBedLettiniCount(bed, bedsConfig);
      const defaultItems = getBedItems(bed, numLettini);
      const risorse = booking.risorse && booking.risorse.length > 0
        ? booking.risorse
        : [{ postazione: bed, items: defaultItems }];

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
      transaction.set(lockRef, { lastUpdated: new Date().toISOString() });

      return finalBooking;
    });

    return { success: true, booking: result };
  } catch (err: any) {
    console.error("Transactional booking failed:", err.message);
    return { success: false, error: err.message };
  }
}
