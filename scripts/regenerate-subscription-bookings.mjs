import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, writeBatch, query, where } from "firebase/firestore";

// Read Firebase Config
const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
if (!fs.existsSync(configPath)) {
  console.error("Errore: file firebase-applet-config.json non trovato!");
  process.exit(1);
}

const fbConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Initialize Firebase App
const app = initializeApp({
  apiKey: fbConfig.apiKey,
  authDomain: fbConfig.authDomain,
  projectId: fbConfig.projectId,
  storageBucket: fbConfig.storageBucket,
  messagingSenderId: fbConfig.messagingSenderId,
  appId: fbConfig.appId
});

// Get Firestore reference with custom database ID
const db = getFirestore(app, fbConfig.firestoreDatabaseId || "(default)");

// Helper to generate dates range
function getDatesInRange(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  while (start <= end) {
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, "0");
    const d = String(start.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    start.setDate(start.getDate() + 1);
  }
  return dates;
}

// Check if weekend day
function isWeekend(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dObj = new Date(year, month - 1, day);
  const dayOfWeek = dObj.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function parseItalianDateToYYYYMMDD(italianStr) {
  if (!italianStr) return null;
  const normalized = italianStr.toLowerCase().replace(/,/g, " ").trim();
  const parts = normalized.split(/\s+/);
  
  const ITALIAN_MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
  ];
  
  let day = null;
  let month = null;
  let year = null;
  
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) {
      year = parseInt(part, 10);
    } else if (/^\d{1,2}$/.test(part)) {
      if (day === null) {
        day = parseInt(part, 10);
      }
    } else {
      const idx = ITALIAN_MONTHS.indexOf(part);
      if (idx !== -1) {
        month = idx + 1;
      }
    }
  }
  
  if (day !== null && month !== null && year !== null) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function getWaivedDatesForSub(subId, ledger) {
  const waivedDates = new Set();
  const subLedger = ledger.filter(l => l.subscriptionId === subId && l.kind === "day_waiver_credit");
  for (const entry of subLedger) {
    if (entry.note && entry.note.startsWith("Rinuncia ")) {
      let clean = entry.note.replace("Rinuncia ", "");
      const parenIdx = clean.indexOf("(");
      if (parenIdx !== -1) {
        clean = clean.substring(0, parenIdx).trim();
      }
      const dateParts = clean.split(" - ");
      if (dateParts.length === 2) {
        const startYMD = parseItalianDateToYYYYMMDD(dateParts[0]);
        const endYMD = parseItalianDateToYYYYMMDD(dateParts[1]);
        if (startYMD && endYMD) {
          const rangeDates = getDatesInRange(startYMD, endYMD);
          rangeDates.forEach(d => waivedDates.add(d));
        }
      }
    }
  }
  return waivedDates;
}

// Get list of bed items
function getBedItems(bNum) {
  // Samarinda standard: postazioni have 2 lettini
  return ["ombrellone", "lettino_1", "lettino_2"];
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  console.log("==================================================");
  console.log("REGENERATION SCRIPT FOR SUBSCRIPTION BOOKINGS");
  console.log(`DryRun Mode: ${dryRun ? "ATTIVO (Modifiche simulate)" : "DISATTIVATO (Modifiche REALI sul database)"}`);
  console.log("==================================================");

  // 1. Load active subscriptions
  console.log("Caricamento abbonamenti attivi...");
  const subsSnapshot = await getDocs(query(collection(db, "subscriptions"), where("status", "==", "active")));
  const activeSubs = [];
  subsSnapshot.forEach((docSnap) => {
    activeSubs.push({ id: docSnap.id, ...docSnap.data() });
  });
  console.log(`Trovati ${activeSubs.length} abbonamenti attivi.`);

  // 2. Load existing subscription bookings
  console.log("Caricamento prenotazioni da abbonamento esistenti...");
  const bookingsSnapshot = await getDocs(query(collection(db, "bookings"), where("source", "==", "subscription")));
  const existingSubBookings = [];
  bookingsSnapshot.forEach((docSnap) => {
    existingSubBookings.push({ id: docSnap.id, ...docSnap.data() });
  });
  console.log(`Trovate ${existingSubBookings.length} prenotazioni da abbonamento esistenti.`);

  // Load ledger entries to respect waived dates
  console.log("Caricamento registro ledger...");
  const ledgerSnapshot = await getDocs(collection(db, "ledger"));
  const ledgerList = [];
  ledgerSnapshot.forEach((docSnap) => {
    ledgerList.push({ id: docSnap.id, ...docSnap.data() });
  });
  console.log(`Trovate ${ledgerList.length} voci ledger.`);

  // Index existing bookings by date and bedNumber to help calculate shared resources
  const bookingsByDateAndBed = {};
  existingSubBookings.forEach((b) => {
    const key = `${b.date}_${b.bedNumber}`;
    if (!bookingsByDateAndBed[key]) {
      bookingsByDateAndBed[key] = [];
    }
    bookingsByDateAndBed[key].push(b);
  });

  const bookingsToDelete = [];
  const bookingsToCreate = [];

  // 3. For each active subscription, plan its new bookings
  activeSubs.forEach((sub) => {
    let dates = getDatesInRange(sub.startDate, sub.endDate);
    if (sub.soloWeekend) {
      dates = dates.filter(isWeekend);
    }

    const waivedDates = getWaivedDatesForSub(sub.id, ledgerList);
    dates = dates.filter(d => !waivedDates.has(d));

    const beds = sub.bedNumbers || [];

    dates.forEach((dt) => {
      beds.forEach((bNum) => {
        const slotKey = sub.slot === "full_day" ? "full" : sub.slot;
        
        // Target deterministic ID
        const targetId = `${dt}_${bNum}_${slotKey}_${sub.id}`;

        // Find existing booking for this date/bed/subscription to clear it out
        const oldBookings = existingSubBookings.filter(
          (eb) => eb.subscriptionId === sub.id && eb.date === dt && eb.bedNumber === bNum
        );
        oldBookings.forEach((ob) => {
          bookingsToDelete.push(ob.id);
        });

        // Determine assigned items
        let assignedItems = ["ombrellone", "lettino_1", "lettino_2"];
        if (sub.slotTypeId === "1LIG") {
          // Check other bookings on the same date and bed that are NOT for this subscription
          const otherBookings = (bookingsByDateAndBed[`${dt}_${bNum}`] || []).filter(
            (ob) => ob.subscriptionId !== sub.id
          );

          const occupiedLettini = new Set();
          otherBookings.forEach((ob) => {
            const res = ob.risorse && ob.risorse.find((r) => r.postazione === bNum);
            const items = res ? res.items : ["ombrellone", "lettino_1", "lettino_2"];
            items.forEach((it) => {
              if (it.startsWith("lettino")) {
                occupiedLettini.add(it);
              }
            });
          });

          if (!occupiedLettini.has("lettino_1")) {
            assignedItems = ["ombrellone", "lettino_1"];
          } else {
            assignedItems = ["ombrellone", "lettino_2"];
          }
        }

        const newBooking = {
          id: targetId,
          bedNumber: bNum,
          date: dt,
          slot: sub.slot,
          tipoPrenotazione: "intera",
          risorse: [{ postazione: bNum, items: assignedItems }],
          customerId: sub.customerId,
          customerName: sub.customerName,
          customerPhone: sub.customerPhone || "",
          customerType: "subscriber",
          subscriptionId: sub.id,
          source: "subscription",
          notes: "",
          isConfirmedPayPerDay: sub.dealType === "pay_per_day" ? false : true,
          dealType: sub.dealType || "seasonal",
          createdAt: new Date().toISOString()
        };

        bookingsToCreate.push(newBooking);
      });
    });
  });

  // Filter out any duplicate deletes to be safe
  const uniqueDeletes = [...new Set(bookingsToDelete)];

  console.log(`\nPianificate ${uniqueDeletes.length} eliminazioni di prenotazioni obsolete.`);
  console.log(`Pianificate ${bookingsToCreate.length} creazioni di prenotazioni con il nuovo schema.`);

  if (dryRun) {
    console.log("\n[SIMULAZIONE]: Esempi di prenotazioni da creare:");
    bookingsToCreate.slice(0, 5).forEach((b) => {
      console.log(` - ID: ${b.id}`);
      console.log(`   Cliente: ${b.customerName} (${b.customerId})`);
      console.log(`   Data: ${b.date} | Slot: ${b.slot}`);
      console.log(`   Risorse: ${JSON.stringify(b.risorse)}`);
    });
    console.log("\nPer eseguire realmente la migrazione sul database, esegui il comando con la flag --execute:");
    console.log("node scripts/regenerate-subscription-bookings.mjs --execute");
    return;
  }

  // 4. Perform actual database batch writes
  console.log("\nEsecuzione eliminazione prenotazioni obsolete...");
  let batch = writeBatch(db);
  let opCount = 0;

  for (const docId of uniqueDeletes) {
    batch.delete(doc(db, "bookings", docId));
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      console.log(`Eseguiti ${opCount} delete...`);
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
    console.log(`Eseguiti ultimi ${opCount} delete.`);
  }

  console.log("\nEsecuzione creazione nuove prenotazioni deterministiche...");
  batch = writeBatch(db);
  opCount = 0;

  for (const b of bookingsToCreate) {
    batch.set(doc(db, "bookings", b.id), b);
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      console.log(`Eseguiti ${opCount} set...`);
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
    console.log(`Eseguiti ultimi ${opCount} set.`);
  }

  console.log("\nREGENERATION COMPLETATA CON SUCCESSO!");
}

run().catch((err) => {
  console.error("Errore irreversibile durante la rigenerazione:", err);
  process.exit(1);
});
