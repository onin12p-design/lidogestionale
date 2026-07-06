import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
// @ts-ignore
import mammoth from "mammoth";

// Firebase web imports for server-side API proxying
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import firebaseConfig from "./firebase-applet-config.json";

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Firebase App on the server
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(firebaseApp);

let isServerAuth = false;
let serverAuthError: any = null;

export async function ensureServerAuth() {
  if (isServerAuth && auth.currentUser) {
    return;
  }
  try {
    const credential = await signInAnonymously(auth);
    isServerAuth = true;
    serverAuthError = null;
    console.log("Server authenticated with Firestore successfully:", credential.user.uid);
  } catch (err: any) {
    isServerAuth = false;
    serverAuthError = err;
    console.warn("Server anonymous auth failed (proceeding in unauthenticated fallback mode):", err);
    // Do not throw; proceed unauthenticated so that the server can still make queries if firestore.rules allows it or are not yet active.
  }
}

// Initial server-side auth attempt
ensureServerAuth().catch((err) => {
  console.warn("Initial server anonymous auth failed. Will retry on request.");
});

// Setup JSON and URL-encoded body parsers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Setup Multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// Set of valid bed numbers as defined by the immutable map
const VALID_BEDS = new Set([
  // PEDANA SINISTRA — LEFT
  1, 2, 3, 4, 5,
  11, 12, 13, 14, 15,
  21, 22, 23, 24, 25,
  31, 32, 33, 34,
  // PEDANA SINISTRA — RIGHT
  6, 7, 8, 9, 10,
  16, 17, 18, 19, 20,
  26, 27, 28, 29, 30,
  // PEDANA DESTRA — LEFT
  60, 61, 62, 63, 64,
  71, 72, 73, 74, 75,
  82, 83, 84, 85, 86,
  93, 94, 95, 96, 97,
  // PEDANA DESTRA — RIGHT
  65, 66, 67, 68, 69, 70,
  76, 77, 78, 79, 80, 81,
  87, 88, 89, 90, 91, 92,
  98, 99, 100, 101, 102, 103,
  104, 105, 106, 107, 108, 109
]);

// Lazy-initialized Gemini client to prevent crashes on startup if key is missing
let aiInstance: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return aiInstance;
}

// Robust helper to perform Gemini generation with retry logic for transient/overloaded errors
async function generateContentWithRetry(ai: GoogleGenAI, params: any, retries = 4, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const status = err.status || err.statusCode;
      const message = String(err.message || "").toUpperCase();
      const isTransient = 
        !status || 
        status === 503 || 
        status === 429 || 
        status === 500 ||
        status === 504 ||
        message.includes("503") ||
        message.includes("429") ||
        message.includes("UNAVAILABLE") ||
        message.includes("TEMPORARY") ||
        message.includes("DEMAND") ||
        message.includes("EXHAUSTED");

      if (isTransient && i < retries - 1) {
        const waitTime = delay * Math.pow(2, i);
        console.warn(`Gemini API returned a transient error (${err.message || err}). Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Failed after maximum retries");
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// POST staff login endpoint checking environment variable
app.post("/api/staff-login", (req, res) => {
  const { password } = req.body;
  const staffPassword = process.env.SECRET_STAFF_PASSWORD || "samarinda2026";
  if (password === staffPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// GET available Gemini models
app.get("/api/verify-models", async (req, res) => {
  try {
    const ai = getGemini();
    const result = await ai.models.list();
    res.json({ success: true, models: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// Timezone date helper for server validations
function getRomeTodayStringServer(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

// Check if a date string is in YYYY-MM-DD format and is between today and today+60 days
function isValidDateRange(dateStr: string): boolean {
  const dateReg = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateStr || !dateReg.test(dateStr)) return false;

  const todayStr = getRomeTodayStringServer();
  if (dateStr < todayStr) return false;

  // Compute 60 days ahead
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const maxDate = new Date(ty, tm - 1, td + 60);
  const maxYear = maxDate.getFullYear();
  const maxMonth = String(maxDate.getMonth() + 1).padStart(2, "0");
  const maxDay = String(maxDate.getDate()).padStart(2, "0");
  const maxStr = `${maxYear}-${maxMonth}-${maxDay}`;

  return dateStr <= maxStr;
}

// Cache store for availability queries (30 seconds TTL)
const availabilityCache: Record<string, { timestamp: number; data: any }> = {};

function getBedLettiniCountBackend(bedNum: number, bedsConfig: Record<string, any>): number {
  if (bedsConfig && bedsConfig[String(bedNum)] !== undefined) {
    return Number(bedsConfig[String(bedNum)]);
  }
  return 2; // Default
}

function getBedItemsBackend(bedNum: number, numLettini: number): string[] {
  const items = ["ombrellone"];
  for (let i = 1; i <= numLettini; i++) {
    items.push(`lettino_${i}`);
  }
  return items;
}

// Public secure client-side API endpoint for beach availability
app.get("/api/availability", async (req, res) => {
  try {
    const { date } = req.query;
    if (typeof date !== "string") {
      res.status(400).json({ error: "Parametro 'date' mancante." });
      return;
    }

    if (!isValidDateRange(date)) {
      res.status(400).json({ error: "La data fornita deve essere compresa tra oggi e i prossimi 60 giorni." });
      return;
    }

    // Check Cache (30 seconds)
    const now = Date.now();
    const cached = availabilityCache[date];
    if (cached && (now - cached.timestamp < 30000)) {
      res.json(cached.data);
      return;
    }

    // Fetch from Firestore
    try {
      await ensureServerAuth();
    } catch (authErr: any) {
      console.error("Authentication failure before Firestore fetch:", authErr);
      res.status(500).json({
        error: "Autenticazione non riuscita. Verificare la connessione.",
        details: authErr.message || String(authErr)
      });
      return;
    }

    // Fetch beds configuration
    const bedsConfigRef = doc(db, "settings", "beds");
    const bedsConfigSnap = await getDoc(bedsConfigRef);
    const bedsConfig = bedsConfigSnap.exists() ? (bedsConfigSnap.data() as Record<string, any>) : {};

    // Fetch bookings for specified date
    const bookingsQuery = query(collection(db, "bookings"), where("date", "==", date));
    const snapshot = await getDocs(bookingsQuery);

    // Map existing bookings by bed number
    const bedBookings: Record<number, any[]> = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const bedNum = Number(data.bedNumber);
      if (!bedBookings[bedNum]) {
        bedBookings[bedNum] = [];
      }
      bedBookings[bedNum].push(data);
    });

    let totalItemsCount = 0;
    let occupiedItemsCount = 0;

    // Build complete availability for all 109 beds
    const availabilityList = Array.from(VALID_BEDS).map((bedNum) => {
      const numLettini = getBedLettiniCountBackend(bedNum, bedsConfig);
      const totalItems = numLettini + 1; // ombrellone + lettini
      totalItemsCount += totalItems;

      const bookings = bedBookings[bedNum] || [];
      const defaultItems = getBedItemsBackend(bedNum, numLettini);

      const itemMorningOccupied = new Set<string>();
      const itemAfternoonOccupied = new Set<string>();

      bookings.forEach((b) => {
        let items: string[] = [];
        if (b.risorse && b.risorse.length > 0) {
          const res = b.risorse.find((r: any) => r.postazione === bedNum);
          if (res) items = res.items;
        } else {
          // legacy fallback
          items = defaultItems;
        }

        const isAbbonato = b.tipoPrenotazione === "abbonato";
        const isFull = b.slot === "full_day" || isAbbonato;

        if (b.slot === "morning") {
          items.forEach(it => itemMorningOccupied.add(it));
        } else if (b.slot === "afternoon") {
          items.forEach(it => itemAfternoonOccupied.add(it));
        } else if (isFull) {
          items.forEach(it => {
            itemMorningOccupied.add(it);
            itemAfternoonOccupied.add(it);
          });
        }
      });

      const uniqueOccupiedItems = new Set<string>([...itemMorningOccupied, ...itemAfternoonOccupied]);
      occupiedItemsCount += uniqueOccupiedItems.size;

      let status: "free" | "morning_free" | "afternoon_free" | "partial" | "full" = "free";

      const totalSlots = totalItems * 2;
      const occupiedSlots = itemMorningOccupied.size + itemAfternoonOccupied.size;

      if (occupiedSlots === 0) {
        status = "free";
      } else if (occupiedSlots === totalSlots) {
        status = "full";
      } else {
        // Partial slot occupancy categories (MODIFICA 7)
        if (itemMorningOccupied.size >= totalItems && itemAfternoonOccupied.size === 0) {
          status = "afternoon_free";
        } else if (itemAfternoonOccupied.size >= totalItems && itemMorningOccupied.size === 0) {
          status = "morning_free";
        } else {
          status = "partial";
        }
      }

      return {
        bedNumber: bedNum,
        status,
        occupiedCount: uniqueOccupiedItems.size,
        totalItems
      };
    });

    const responseData = {
      availability: availabilityList,
      totalItemsCount,
      occupiedItemsCount,
      freeItemsCount: totalItemsCount - occupiedItemsCount
    };

    // Save to Cache
    availabilityCache[date] = {
      timestamp: now,
      data: responseData
    };

    res.json(responseData);
  } catch (error: any) {
    console.error("Errore nell'endpoint /api/availability:", error);
    res.status(500).json({ error: "Errore nel caricamento della disponibilità." });
  }
});

// Helper to validate customer name
function isValidCustomerName(name: string): boolean {
  const clean = name.trim();
  if (!clean) return false;
  if (/^[.\-\s_]+$/.test(clean)) return false;
  return true;
}

interface TableCell {
  text: string;
}
type TableRow = TableCell[];
type Table = TableRow[];

// Helper to extract tables from mammoth HTML
function parseHtmlTables(html: string): Table[] {
  const tables: Table[] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rows: TableRow[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: TableCell[] = [];
      const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        let cellContent = cellMatch[2];
        cellContent = cellContent.replace(/<[^>]+>/g, " ");
        cellContent = cellContent
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"');
        
        const cleanText = cellContent.replace(/\s+/g, " ").trim();
        cells.push({ text: cleanText });
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    if (rows.length > 0) {
      tables.push(rows);
    }
  }
  
  return tables;
}

// Deterministic parser for DOCX beach map records
async function parseDocxDeterministic(buffer: Buffer, originalName: string) {
  const convertResult = await mammoth.convertToHtml({ buffer });
  const html = convertResult.value;

  const tables = parseHtmlTables(html);
  if (tables.length === 0) {
    throw new Error("Nessuna tabella trovata nel documento DOCX.");
  }

  // 1. Identify pedana (Sinistra: 1-34 vs Destra: 60-109)
  let pedana: "sinistra" | "destra" | null = null;
  for (const table of tables) {
    for (const row of table) {
      for (const cell of row) {
        const text = cell.text.toUpperCase();
        if (text.includes("PEDANA SINISTRA")) {
          pedana = "sinistra";
          break;
        } else if (text.includes("PEDANA DESTRA")) {
          pedana = "destra";
          break;
        }
      }
      if (pedana) break;
    }
    if (pedana) break;
  }

  // Fallback to filename
  if (!pedana) {
    const lowerName = originalName.toLowerCase();
    if (lowerName.includes("sx") || lowerName.includes("sinistra")) {
      pedana = "sinistra";
    } else if (lowerName.includes("dx") || lowerName.includes("destra")) {
      pedana = "destra";
    } else {
      pedana = "sinistra";
    }
  }

  const startBed = pedana === "sinistra" ? 1 : 60;
  const maxRows = pedana === "sinistra" ? 34 : 50;

  // 2. Find table with the header row
  let dataTable: Table | null = null;
  let headerRowIndex = -1;

  for (const table of tables) {
    for (let rIndex = 0; rIndex < table.length; rIndex++) {
      const row = table[rIndex];
      const hasMattina = row.some(cell => cell.text.toUpperCase().includes("MATTINA"));
      const hasPomeriggio = row.some(cell => cell.text.toUpperCase().includes("POMERIGGIO"));
      if (hasMattina && hasPomeriggio) {
        dataTable = table;
        headerRowIndex = rIndex;
        break;
      }
    }
    if (dataTable) break;
  }

  if (!dataTable || headerRowIndex === -1) {
    throw new Error("Impossibile trovare la tabella dati delle prenotazioni (colonne MATTINA / POMERIGGIO mancanti).");
  }

  const items: any[] = [];
  const dataRows = dataTable.slice(headerRowIndex + 1);
  const rowsToProcess = dataRows.slice(0, maxRows);

  for (let i = 0; i < rowsToProcess.length; i++) {
    const rowCells = rowsToProcess[i];
    const bedNumber = startBed + i;
    const isValidBed = VALID_BEDS.has(bedNumber);

    const mattinaNameRaw = rowCells[1]?.text || "";
    const pomeriggioNameRaw = rowCells[5]?.text || "";

    const mattinaClean = mattinaNameRaw.trim();
    const pomeriggioClean = pomeriggioNameRaw.trim();

    const hasMattina = isValidCustomerName(mattinaClean);
    const hasPomeriggio = isValidCustomerName(pomeriggioClean);

    // Extract L/P/€ markings
    const mL = rowCells[2]?.text || "";
    const mP = rowCells[3]?.text || "";
    const mE = rowCells[4]?.text || "";
    const mattinaMarcature = [mL, mP, mE].map(s => s.trim()).filter(Boolean).join(" ");

    const pL = rowCells[6]?.text || "";
    const pP = rowCells[7]?.text || "";
    const pE = rowCells[8]?.text || "";
    const pomeriggioMarcature = [pL, pP, pE].map(s => s.trim()).filter(Boolean).join(" ");

    const daConfermareM = mattinaNameRaw.toLowerCase().includes("da confermare");
    const daConfermareP = pomeriggioNameRaw.toLowerCase().includes("da confermare");

    const cleanCustomerName = (rawName: string): string => {
      let name = rawName.replace(/da confermare/gi, "").replace(/\s+/g, " ").trim();
      if (!name || /^[.\-\s_]+$/.test(name)) {
        return "Cliente";
      }
      return name;
    };

    const buildNotes = (baseMarcature: string, isDaConfermare: boolean): string => {
      const parts: string[] = [];
      if (baseMarcature) {
        parts.push(`Segnato: ${baseMarcature}`);
      }
      if (isDaConfermare) {
        parts.push("Da confermare");
      }
      return parts.join(" | ");
    };

    if (hasMattina && hasPomeriggio) {
      if (mattinaClean.toUpperCase() === pomeriggioClean.toUpperCase()) {
        const finalName = cleanCustomerName(mattinaClean);
        const isConfirm = daConfermareM || daConfermareP || mattinaClean.toLowerCase().includes("da confermare") || pomeriggioClean.toLowerCase().includes("da confermare");

        let finalMarcNotes = "";
        if (mattinaMarcature && pomeriggioMarcature) {
          if (mattinaMarcature === pomeriggioMarcature) {
            finalMarcNotes = mattinaMarcature;
          } else {
            finalMarcNotes = `mattina: ${mattinaMarcature}, pomeriggio: ${pomeriggioMarcature}`;
          }
        } else {
          finalMarcNotes = mattinaMarcature || pomeriggioMarcature;
        }

        const notes = buildNotes(finalMarcNotes, isConfirm);
        const isSubscriber = finalName.toLowerCase().includes("abbonato") || 
                             notes.toLowerCase().includes("abbonato") ||
                             rowCells.some(c => c?.text?.toLowerCase().includes("abbonato"));

        items.push({
          bedNumber,
          customerName: finalName,
          customerType: isSubscriber ? "subscriber" : "daily",
          slot: "full_day",
          notes,
          isValidBed,
          fileName: originalName
        });
      } else {
        // Morning booking
        const mName = cleanCustomerName(mattinaClean);
        const mConfirm = daConfermareM || mattinaClean.toLowerCase().includes("da confermare");
        const mNotes = buildNotes(mattinaMarcature, mConfirm);
        const mSub = mName.toLowerCase().includes("abbonato") || mNotes.toLowerCase().includes("abbonato") || rowCells.some(c => c?.text?.toLowerCase().includes("abbonato"));

        items.push({
          bedNumber,
          customerName: mName,
          customerType: mSub ? "subscriber" : "daily",
          slot: "morning",
          notes: mNotes,
          isValidBed,
          fileName: originalName
        });

        // Afternoon booking
        const pName = cleanCustomerName(pomeriggioClean);
        const pConfirm = daConfermareP || pomeriggioClean.toLowerCase().includes("da confermare");
        const pNotes = buildNotes(pomeriggioMarcature, pConfirm);
        const pSub = pName.toLowerCase().includes("abbonato") || pNotes.toLowerCase().includes("abbonato") || rowCells.some(c => c?.text?.toLowerCase().includes("abbonato"));

        items.push({
          bedNumber,
          customerName: pName,
          customerType: pSub ? "subscriber" : "daily",
          slot: "afternoon",
          notes: pNotes,
          isValidBed,
          fileName: originalName
        });
      }
    } else if (hasMattina) {
      const mName = cleanCustomerName(mattinaClean);
      const mConfirm = daConfermareM || mattinaClean.toLowerCase().includes("da confermare");
      const mNotes = buildNotes(mattinaMarcature, mConfirm);
      const mSub = mName.toLowerCase().includes("abbonato") || mNotes.toLowerCase().includes("abbonato") || rowCells.some(c => c?.text?.toLowerCase().includes("abbonato"));

      items.push({
        bedNumber,
        customerName: mName,
        customerType: mSub ? "subscriber" : "daily",
        slot: "morning",
        notes: mNotes,
        isValidBed,
        fileName: originalName
      });
    } else if (hasPomeriggio) {
      const pName = cleanCustomerName(pomeriggioClean);
      const pConfirm = daConfermareP || pomeriggioClean.toLowerCase().includes("da confermare");
      const pNotes = buildNotes(pomeriggioMarcature, pConfirm);
      const pSub = pName.toLowerCase().includes("abbonato") || pNotes.toLowerCase().includes("abbonato") || rowCells.some(c => c?.text?.toLowerCase().includes("abbonato"));

      items.push({
        bedNumber,
        customerName: pName,
        customerType: pSub ? "subscriber" : "daily",
        slot: "afternoon",
        notes: pNotes,
        isValidBed,
        fileName: originalName
      });
    }
  }

  return items;
}

// API endpoint to parse uploaded files using Gemini or deterministic parser
app.post("/api/parse-scanner", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nessun file caricato." });
      return;
    }

    const allExtractedItems: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const isDocx = file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
                       file.originalname.toLowerCase().endsWith(".docx");

        if (isDocx) {
          // Bypassing Gemini: use the fast, free, accurate deterministic parser
          console.log(`Deterministic parsing DOCX file: ${file.originalname}`);
          try {
            const docxItems = await parseDocxDeterministic(file.buffer, file.originalname);
            allExtractedItems.push(...docxItems);
          } catch (docxErr: any) {
            console.error(`Errore nel parser DOCX per il file ${file.originalname}:`, docxErr);
            errors.push(`File ${file.originalname}: Errore di parsing deterministico: ${docxErr.message || String(docxErr)}`);
          }
        } else {
          // Keep Gemini pathway for images
          console.log(`AI-assisted parsing image file: ${file.originalname}`);
          try {
            const ai = getGemini();
            const promptText = `
Estrai tutte le prenotazioni o registrazioni del lido presenti in questo documento o immagine.
Estrai un elenco strutturato con le seguenti informazioni per ciascuna riga trovata:
- bedNumber: il numero del lettino (un intero tra 1 e 109).
- customerName: il nome o cognome del cliente. Se non disponibile, usa una descrizione generica come 'Cliente'.
- customerType: il tipo di cliente. Può essere 'daily' (giornaliero, es. se ha pagato una singola giornata) o 'subscriber' (abbonato, stagionale). Cerca indizi come 'abbonato', 'abbonamento', 'stagionale', 'fisso' o 'giornaliero'. Di default usa 'daily'.
- slot: la fascia oraria. Deve essere una delle seguenti: 'morning' (mattina), 'afternoon' (pomeriggio), o 'full_day' (giornata intera). Cerca riferimenti come 'mattina', 'pomeriggio', '9-13', '13-19', 'giornata intera' o orari estesi. Di default usa 'full_day'.
- notes: eventuali note aggiuntive estratte (es. richieste speciali, acconti, etc.).

Se trovi righe che fanno riferimento a lettini multipli (es. 'Lettini 12 e 13'), crea righe separate per ciascun lettino.
Restituisci solo un array di oggetti validi secondo la risposta strutturata JSON richiesta.
            `;

            const base64Data = file.buffer.toString("base64");
            const filePart = {
              inlineData: {
                mimeType: file.mimetype,
                data: base64Data
              }
            };
            const contents = [
              filePart,
              { text: promptText }
            ];

            const response = await generateContentWithRetry(ai, {
              model: "gemini-2.5-flash",
              contents,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    items: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          bedNumber: {
                            type: Type.INTEGER,
                            description: "Il numero del lettino (1-109)."
                          },
                          customerName: {
                            type: Type.STRING,
                            description: "Il nome completo o identificativo del cliente."
                          },
                          customerType: {
                            type: Type.STRING,
                            enum: ["daily", "subscriber"],
                            description: "Tipo di cliente: daily o subscriber."
                          },
                          slot: {
                            type: Type.STRING,
                            enum: ["morning", "afternoon", "full_day"],
                            description: "Fascia oraria della prenotazione."
                          },
                          notes: {
                            type: Type.STRING,
                            description: "Eventuali note estratte."
                          }
                        },
                        required: ["bedNumber", "customerName", "customerType", "slot"]
                      }
                    }
                  },
                  required: ["items"]
                }
              }
            });

            const textResult = response.text;
            if (textResult) {
              const parsed = JSON.parse(textResult.trim());
              if (parsed && Array.isArray(parsed.items)) {
                parsed.items.forEach((item: any) => {
                  const num = Number(item.bedNumber);
                  const isValid = VALID_BEDS.has(num);
                  
                  allExtractedItems.push({
                    ...item,
                    bedNumber: num,
                    isValidBed: isValid,
                    fileName: file.originalname
                  });
                });
              }
            }
          } catch (geminiErr: any) {
            console.error(`Errore nel parser Gemini per il file ${file.originalname}:`, geminiErr);
            errors.push(`File ${file.originalname}: Errore di analisi AI: ${geminiErr.message || String(geminiErr)}`);
          }
        }
      } catch (err: any) {
        console.error("Errore generico nel ciclo file:", err);
        errors.push(`File ${file.originalname}: ${err.message || String(err)}`);
      }
    }

    res.json({
      success: true,
      items: allExtractedItems,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error: any) {
    console.error("Errore generale nell'endpoint /api/parse-scanner:", error);
    res.status(500).json({ error: error.message || "Errore durante l'elaborazione dei documenti con Gemini." });
  }
});

// Global error handling middleware to prevent HTML error pages and always return JSON
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled global server error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Errore interno del server.",
    details: process.env.NODE_ENV !== "production" ? err.stack || String(err) : undefined
  });
});

// Setup Vite Dev Server / Static files
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error("Failed to setup server:", err);
});
