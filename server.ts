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
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";
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
        error: "Autenticazione non riuscita. Verificare la connessione o che il provider Anonimo sia abilitato nella console Firebase.",
        details: authErr.message || String(authErr)
      });
      return;
    }

    const bookingsQuery = query(collection(db, "bookings"), where("date", "==", date));
    const snapshot = await getDocs(bookingsQuery);

    // Map existing bookings by bed number
    const bedBookings: Record<number, { morning?: boolean; afternoon?: boolean; full_day?: boolean }> = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const bedNum = Number(data.bedNumber);
      const slot = data.slot as string;
      if (!bedBookings[bedNum]) {
        bedBookings[bedNum] = {};
      }
      if (slot === "morning") bedBookings[bedNum].morning = true;
      if (slot === "afternoon") bedBookings[bedNum].afternoon = true;
      if (slot === "full_day") bedBookings[bedNum].full_day = true;
    });

    // Build complete availability for all 109 beds
    const availabilityList = Array.from(VALID_BEDS).map((bedNum) => {
      const bookings = bedBookings[bedNum];
      let status: "free" | "morning_free" | "afternoon_free" | "full" = "free";

      if (bookings) {
        if (bookings.full_day || (bookings.morning && bookings.afternoon)) {
          status = "full";
        } else if (bookings.morning) {
          status = "afternoon_free"; // morning occupied -> afternoon free
        } else if (bookings.afternoon) {
          status = "morning_free"; // afternoon occupied -> morning free
        }
      }

      return {
        bedNumber: bedNum,
        status
      };
    });

    // Save to Cache
    availabilityCache[date] = {
      timestamp: now,
      data: availabilityList
    };

    res.json(availabilityList);
  } catch (error: any) {
    console.error("Errore nell'endpoint /api/availability:", error);
    res.status(500).json({ error: "Errore nel caricamento della disponibilità." });
  }
});

// API endpoint to parse uploaded files using Gemini
app.post("/api/parse-scanner", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nessun file caricato." });
      return;
    }

    const ai = getGemini();
    const allExtractedItems: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const isDocx = file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
                       file.originalname.toLowerCase().endsWith(".docx");

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

        let contents: any[] = [];

        if (isDocx) {
          const mammothResult = await mammoth.extractRawText({ buffer: file.buffer });
          const docxText = mammothResult.value;
          contents = [
            { text: `CONTENUTO DEL DOCUMENTO WORD:\n${docxText}` },
            { text: promptText }
          ];
        } else {
          const base64Data = file.buffer.toString("base64");
          const filePart = {
            inlineData: {
              mimeType: file.mimetype,
              data: base64Data
            }
          };
          contents = [
            filePart,
            { text: promptText }
          ];
        }

        const response = await generateContentWithRetry(ai, {
          model: "gemini-3.5-flash",
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
              // Perform validation on bed number
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
      } catch (err: any) {
        console.error("Errore nel parsing del singolo file:", err);
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
