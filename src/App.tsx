import React, { useState, useEffect } from "react";
import { signInAnonymously } from "firebase/auth";
import { collection, query, where, onSnapshot, doc, setDoc } from "firebase/firestore";
import { auth, db } from "./lib/firebase";
import { getRomeTodayString, formatItalianDate } from "./utils";
import { Booking, Tab, Payment, Subscription, Customer, LedgerEntry, Attendance } from "./types";

// Import modules
import DailyMapModule from "./components/DailyMapModule";
import ScannerModule from "./components/ScannerModule";
import SubscriptionsModule from "./components/SubscriptionsModule";
import CashierModule from "./components/CashierModule";
import PricingModule from "./components/PricingModule";
import ClientView from "./components/ClientView"; // Vista Cliente pubblica (C)

// Icons
import { LayoutDashboard, QrCode, Users, Euro, Sparkles, Loader2, RefreshCw, Lock, LogOut, Globe, AlertTriangle, X } from "lucide-react";

type ActiveTab = "map" | "scanner" | "subscriptions" | "cashier" | "pricing";

export default function App() {
  const [currentDate, setCurrentDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("map");
  const [isAuth, setIsAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  // Cross-linking subscriber state (B1/B2)
  const [preSelectedSubId, setPreSelectedSubId] = useState<string | null>(null);

  // Selected bed state shared with map (B1)
  const [selectedBed, setSelectedBed] = useState<number | null>(null);

  // Routing and Staff Authentication states (C)
  const [path, setPath] = useState(window.location.pathname);
  const [isLoggedStaff, setIsLoggedStaff] = useState(() => {
    return localStorage.getItem("samarinda_logged_staff") === "true";
  });
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  // Firestore Synced States
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [pricingConfigs, setPricingConfigs] = useState<any[]>([]);
  const [bedsConfig, setBedsConfig] = useState<Record<number, number>>({});
  const [rowsConfig, setRowsConfig] = useState<Record<number, number>>({});
  const [subscriptionSetup, setSubscriptionSetup] = useState<{ periods: any[], slotTypes: any[] }>({ periods: [], slotTypes: [] });
  const [priceList, setPriceList] = useState<{ entries: any[] }>({ entries: [] });
  const [loadingData, setLoadingData] = useState(true);

  // Popstate location change listener
  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
    };
  }, []);

  // Simple SPA navigate helper
  const navigateTo = (newPath: string) => {
    window.history.pushState({}, "", newPath);
    setPath(newPath);
  };

  // Init date in Europe/Rome timezone on first load
  useEffect(() => {
    setCurrentDate(getRomeTodayString());
  }, []);

  // 1. Authenticate Staff Anonymously on Mount
  useEffect(() => {
    setAuthLoading(true);
    signInAnonymously(auth)
      .then(() => {
        setIsAuth(true);
        setAuthError(false);
        setAuthLoading(false);
      })
      .catch((error) => {
        console.error("Firebase anonymous auth failed:", error);
        setIsAuth(false);
        setAuthError(true);
        setAuthLoading(false);
      });
  }, []);

  // 2. Real-time Firestore Sync based on currentDate and Auth
  useEffect(() => {
    if (!isAuth || !currentDate) return;

    setLoadingData(true);

    // Bookings for selected date
    const bookingsQuery = query(
      collection(db, "bookings"),
      where("date", "==", currentDate)
    );
    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Booking);
      });
      setBookings(list);
    }, (err) => console.error("Bookings sync error:", err));

    // Tabs for selected date
    const tabsQuery = query(
      collection(db, "tabs"),
      where("date", "==", currentDate)
    );
    const unsubscribeTabs = onSnapshot(tabsQuery, (snapshot) => {
      const list: Tab[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Tab);
      });
      setTabs(list);
    }, (err) => console.error("Tabs sync error:", err));

    // Payments: load in realtime with dual queries (main dateStr and legacy bookingId prefix) (MODIFICA 1)
    let mainPaymentsList: Payment[] = [];
    let legacyPaymentsList: Payment[] = [];

    const updateCombinedPayments = () => {
      const mergedMap = new Map<string, Payment>();
      mainPaymentsList.forEach(p => {
        if (p.id) mergedMap.set(p.id, p);
      });
      legacyPaymentsList.forEach(p => {
        if (p.id) mergedMap.set(p.id, p);
      });
      setPayments(Array.from(mergedMap.values()));
    };

    const paymentsMainQuery = query(
      collection(db, "payments"),
      where("dateStr", "==", currentDate)
    );
    const unsubscribePaymentsMain = onSnapshot(paymentsMainQuery, (snapshot) => {
      const list: Payment[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Payment);
      });
      mainPaymentsList = list;
      updateCombinedPayments();
    }, (err) => console.error("Main payments sync error:", err));

    const paymentsLegacyQuery = query(
      collection(db, "payments"),
      where("bookingId", ">=", currentDate),
      where("bookingId", "<=", currentDate + "\uf8ff")
    );
    const unsubscribePaymentsLegacy = onSnapshot(paymentsLegacyQuery, (snapshot) => {
      const list: Payment[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Payment);
      });
      legacyPaymentsList = list;
      updateCombinedPayments();
    }, (err) => console.error("Legacy payments sync error:", err));

    // Subscriptions: load all subscriptions to support historic view
    const subscriptionsQuery = collection(db, "subscriptions");
    const unsubscribeSubscriptions = onSnapshot(subscriptionsQuery, (snapshot) => {
      const list: Subscription[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Subscription);
      });
      setSubscriptions(list);
      setLoadingData(false);
    }, (err) => {
      console.error("Subscriptions sync error:", err);
      setLoadingData(false);
    });

    // Customers collection
    const customersQuery = collection(db, "customers");
    const unsubscribeCustomers = onSnapshot(customersQuery, (snapshot) => {
      const list: Customer[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Customer);
      });
      setCustomers(list);
    }, (err) => console.error("Customers sync error:", err));

    // Ledger collection
    const ledgerQuery = collection(db, "ledger");
    const unsubscribeLedger = onSnapshot(ledgerQuery, (snapshot) => {
      const list: LedgerEntry[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as LedgerEntry);
      });
      setLedger(list);
    }, (err) => console.error("Ledger sync error:", err));

    // Attendance collection
    const attendanceQuery = collection(db, "attendance");
    const unsubscribeAttendance = onSnapshot(attendanceQuery, (snapshot) => {
      const list: Attendance[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Attendance);
      });
      setAttendance(list);
    }, (err) => console.error("Attendance sync error:", err));

    // Pricing configurations
    const pricingQuery = collection(db, "pricing");
    const unsubscribePricing = onSnapshot(pricingQuery, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setPricingConfigs(list);
    }, (err) => console.error("Pricing sync error:", err));

    // Beds configuration
    const bedsConfigRef = doc(db, "settings", "beds");
    const unsubscribeBeds = onSnapshot(bedsConfigRef, (docSnap) => {
      if (docSnap.exists()) {
        setBedsConfig(docSnap.data() as Record<number, number>);
      }
    }, (err) => console.error("Beds settings sync error:", err));

    // Rows configuration
    const rowsConfigRef = doc(db, "settings", "rows");
    const unsubscribeRows = onSnapshot(rowsConfigRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const mapped: Record<number, number> = {};
        Object.entries(data).forEach(([k, v]) => {
          mapped[Number(k)] = Number(v);
        });
        setRowsConfig(mapped);
      } else {
        // Initialize rows config in Firestore if not exists (CR-4)
        const initialRows: Record<string, number> = {};
        const row1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];
        const row2 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81];
        const row3 = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92];
        const row4 = [31, 32, 33, 34, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103];
        const row5 = [104, 105, 106, 107, 108, 109];

        row1.forEach(b => initialRows[b.toString()] = 1);
        row2.forEach(b => initialRows[b.toString()] = 2);
        row3.forEach(b => initialRows[b.toString()] = 3);
        row4.forEach(b => initialRows[b.toString()] = 4);
        row5.forEach(b => initialRows[b.toString()] = 5);

        setDoc(rowsConfigRef, initialRows)
          .then(() => console.log("Initialized rows settings on Firestore."))
          .catch(err => console.error("Error initializing rows settings:", err));
      }
    }, (err) => console.error("Rows settings sync error:", err));

    // Subscription Setup configuration
    const subscriptionSetupRef = doc(db, "config", "subscriptionSetup");
    const unsubscribeSubscriptionSetup = onSnapshot(subscriptionSetupRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSubscriptionSetup({
          periods: data.periods || [],
          slotTypes: data.slotTypes || []
        });
      } else {
        const defaultSetup = {
          periods: [
            { id: "stagionale", label: "Stagionale", dateStart: "2026-06-01", dateEnd: "2026-09-15", active: true },
            { id: "giugno-luglio", label: "Giugno + Luglio", dateStart: "2026-06-01", dateEnd: "2026-07-31", active: true }
          ],
          slotTypes: [
            { id: "1lig", code: "1LIG", label: "1 Lettino Intera Giornata", active: true },
            { id: "2lig", code: "2LIG", label: "2 Lettini Intera Giornata", active: true }
          ]
        };
        setDoc(subscriptionSetupRef, defaultSetup)
          .then(() => console.log("Initialized subscriptionSetup config on Firestore."))
          .catch(err => console.error("Error initializing subscriptionSetup config:", err));
      }
    }, (err) => console.error("subscriptionSetup sync error:", err));

    // Price List configuration
    const priceListRef = doc(db, "config", "priceList");
    const unsubscribePriceList = onSnapshot(priceListRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPriceList({
          entries: data.entries || []
        });
      } else {
        const defaultPriceList = {
          entries: [
            { periodId: "stagionale", slotTypeId: "2lig", price: 1200 },
            { periodId: "stagionale", slotTypeId: "1lig", price: 750 },
            { periodId: "giugno-luglio", slotTypeId: "2lig", price: 800 },
            { periodId: "giugno-luglio", slotTypeId: "1lig", price: 500 }
          ]
        };
        setDoc(priceListRef, defaultPriceList)
          .then(() => console.log("Initialized priceList config on Firestore."))
          .catch(err => console.error("Error initializing priceList config:", err));
      }
    }, (err) => console.error("priceList sync error:", err));

    return () => {
      unsubscribeBookings();
      unsubscribeTabs();
      unsubscribePaymentsMain();
      unsubscribePaymentsLegacy();
      unsubscribeSubscriptions();
      unsubscribeCustomers();
      unsubscribeLedger();
      unsubscribeAttendance();
      unsubscribePricing();
      unsubscribeBeds();
      unsubscribeRows();
      unsubscribeSubscriptionSetup();
      unsubscribePriceList();
    };
  }, [isAuth, currentDate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const response = await fetch("/api/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (data.success) {
        setIsLoggedStaff(true);
        localStorage.setItem("samarinda_logged_staff", "true");
        setPassword("");
      } else {
        setLoginError("Password errata. Riprova.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setLoginError("Errore di connessione con il server.");
    }
  };

  const handleLogout = () => {
    setIsLoggedStaff(false);
    localStorage.removeItem("samarinda_logged_staff");
    setPassword("");
  };

  if (authLoading) {
    return (
      <div id="auth-loading-screen" className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-600">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
        <h2 className="text-base font-bold">Connessione sicura al server lido...</h2>
        <p className="text-xs text-slate-400 mt-1">Stiamo autenticando il terminale.</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div id="auth-error-screen" className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-6 md:p-8">
        <div className="w-full max-w-xl bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden text-left">
          {/* Header */}
          <div className="bg-rose-50 border-b border-rose-100 p-6 flex items-start gap-4">
            <div className="w-12 h-12 bg-rose-500 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-md">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 mb-2">
                Errore d'Accesso (Configurazione Richiesta)
              </span>
              <h2 className="text-xl font-bold text-slate-800 leading-tight font-sans">Abilitare Accesso Anonimo</h2>
              <p className="text-xs text-rose-600 font-semibold mt-1 font-mono">
                Codice: auth/admin-restricted-operation
              </p>
            </div>
          </div>

          {/* Details & Explanation */}
          <div className="p-6 md:p-8 space-y-5">
            <p className="text-xs text-slate-600 leading-relaxed font-sans">
              Per garantire la sicurezza e la conformità delle regole di accesso del database (<strong>default-deny</strong>), l'applicazione richiede un'autenticazione anonima per operare in sicurezza. Il provider "Anonimo" non è ancora attivo sul tuo progetto Firebase.
            </p>

            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-xs text-slate-600 space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-blue-800 font-bold mb-1 font-sans">
                <Globe className="w-4 h-4 shrink-0 text-blue-600" />
                <span>Identificativi Progetto</span>
              </div>
              <p>Progetto: <strong className="font-semibold text-slate-800">gen-lang-client-0413763692</strong></p>
              <p>Database: <strong className="font-semibold text-slate-800">ai-studio-32ba66f9-fa10-4db6-8413-9c47def28b74</strong></p>
            </div>

            {/* Instruction Steps */}
            <div className="space-y-3 font-sans">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Istruzioni Passo-Passo per l'Abilitazione:</h3>
              <div className="space-y-2.5">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                  <div className="text-xs text-slate-600">
                    Accedi alla <strong><a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-0.5 font-bold">Console Firebase <span className="text-[9px]">↗</span></a></strong>.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                  <div className="text-xs text-slate-600">
                    Seleziona il progetto attivo <strong className="text-slate-800 font-semibold">gen-lang-client-0413763692</strong>.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</span>
                  <div className="text-xs text-slate-600">
                    Dal menu di sinistra, fai clic su <strong className="text-slate-800">Build (Crea)</strong> → <strong className="text-slate-800">Authentication</strong>.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">4</span>
                  <div className="text-xs text-slate-600">
                    Seleziona la scheda <strong className="text-slate-800">Sign-in method</strong> (Metodo d'accesso) in alto.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">5</span>
                  <div className="text-xs text-slate-600">
                    Fai clic su <strong className="text-slate-800">Aggiungi nuovo provider</strong> (Add provider) e seleziona <strong className="text-slate-800">Anonimo</strong> (Anonymous).
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">6</span>
                  <div className="text-xs text-slate-600">
                    Attiva l'interruttore <strong>Abilita</strong> (Enable) e fai clic su <strong className="text-slate-800">Salva</strong>.
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3 font-sans">
              <button
                id="btn-retry-auth"
                onClick={() => {
                  setAuthError(false);
                  setAuthLoading(true);
                  signInAnonymously(auth)
                    .then(() => {
                      setIsAuth(true);
                      setAuthError(false);
                      setAuthLoading(false);
                    })
                    .catch((error) => {
                      console.error("Firebase auth retry error:", error);
                      setAuthError(true);
                      setAuthLoading(false);
                    });
                }}
                className="px-6 py-2.5 bg-[#025A70] hover:bg-[#014152] active:bg-[#01313d] text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Ho abilitato l'accesso, Riprova</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Public Client View (C)
  if (path !== "/gestione") {
    return <ClientView bedsConfig={bedsConfig} rowsConfig={rowsConfig} />;
  }

  // Staff Login Page (C)
  if (!isLoggedStaff) {
    return (
      <div id="login-container" className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-[#EFECE6] p-8 shadow-2xl flex flex-col gap-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#EAF4F6] text-[#025A70] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800">Gestionale Samarinda</h2>
            <p className="text-xs text-slate-400 mt-1">Inserisci la password dello staff per accedere</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Password di Sicurezza</label>
              <input
                id="input-staff-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#025A70] transition-all text-center tracking-widest text-lg"
              />
            </div>

            {loginError && (
              <p id="p-login-error" className="text-xs text-rose-600 font-bold text-center bg-rose-50 p-2.5 rounded-xl border border-rose-100">
                {loginError}
              </p>
            )}

            <button
              id="btn-login-submit"
              type="submit"
              className="w-full py-3 bg-[#025A70] hover:bg-[#014152] text-white font-bold rounded-xl shadow-md shadow-[#025A70]/10 transition-colors cursor-pointer text-sm"
            >
              Accedi al Gestionale
            </button>
          </form>

          <button
            id="btn-back-to-client"
            onClick={() => navigateTo("/")}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 justify-center mt-2 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            Torna alla Vista Cliente
          </button>
        </div>
      </div>
    );
  }

  // Full Management Dashboard View (isLoggedStaff === true) (C)
  return (
    <div id="app-viewport" className="min-h-screen bg-[#FDFBF7] flex flex-col font-sans select-none antialiased">
      
      {/* 1. TOP NAV / HEADER */}
      <header id="app-header" className="bg-slate-900 text-white px-4 py-3 md:px-6 md:py-4 shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          <div className="flex items-center gap-2.5">
            <div className="bg-[#025A70] p-2 rounded-xl text-white shadow-lg shadow-[#025A70]/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm md:text-base font-black tracking-tight uppercase">Samarinda Fine Beach</h1>
              <span className="text-[10px] text-[#B3D5DC] font-mono block">Gestionale Lido v2 • Santa Maria di Leuca</span>
            </div>
          </div>

          {/* Sync indicator, Vista Cliente shortcut, Logout & Active Date */}
          <div className="flex items-center gap-3 flex-wrap">
            {loadingData ? (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Aggiornamento...
              </span>
            ) : (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold uppercase">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                In tempo reale
              </span>
            )}

            <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>

            <button
              id="btn-staff-view-client"
              onClick={() => navigateTo("/")}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl border border-slate-700 transition-all flex items-center gap-1 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              Sito Pubblico
            </button>

            <button
              id="btn-staff-logout"
              onClick={handleLogout}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Esci
            </button>

            <div className="h-4 w-px bg-slate-700 hidden sm:block"></div>

            <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700/60 text-xs font-semibold flex items-center gap-1.5">
              <span className="text-slate-400">Data Attiva:</span>
              <span className="text-[#EAF4F6]">{currentDate}</span>
            </div>
          </div>

        </div>
      </header>

      {/* 2. SUB HEADER TAB MENU */}
      <div id="app-tab-navigation" className="bg-white border-b border-[#EFECE6] px-4 shadow-sm py-2 sticky top-14 md:top-16 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto gap-4">
          <div className="flex gap-1 md:gap-2">
            {[
              { id: "map", label: "Mappa Giornaliera", icon: LayoutDashboard },
              { id: "scanner", label: "Scanner Fogli", icon: QrCode },
              { id: "subscriptions", label: "Sezione Abbonati", icon: Users },
              { id: "cashier", label: "Cassa e Tab", icon: Euro },
              { id: "pricing", label: "Listino Prezzi", icon: Sparkles }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`nav-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs md:text-sm font-semibold rounded-xl transition-all duration-150 ${
                    isActive
                      ? "bg-[#025A70] text-white shadow-md shadow-[#025A70]/10"
                      : "text-[#025A70] hover:text-[#014152] hover:bg-[#EAF4F6]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. MAIN DASHBOARD CONTENT AREA */}
      <main id="app-main-content" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-4">
        
        {/* Module Switching */}
        {activeTab === "map" && (
          <DailyMapModule
            currentDate={currentDate}
            onDateChange={(d) => setCurrentDate(d)}
            bookings={bookings}
            tabs={tabs}
            payments={payments}
            onRefresh={() => {}} // real-time sync, no-op (A5)
            selectedBed={selectedBed}
            setSelectedBed={setSelectedBed}
            onOpenSubscriberCard={(id) => {
              setPreSelectedSubId(id);
              setActiveTab("subscriptions");
            }}
            pricingConfigs={pricingConfigs}
            bedsConfig={bedsConfig}
            rowsConfig={rowsConfig}
          />
        )}

        {activeTab === "scanner" && (
          <ScannerModule
            currentDate={currentDate}
            existingBookings={bookings}
            onImportComplete={() => {}} // real-time sync, no-op (A5)
          />
        )}

        {activeTab === "subscriptions" && (
          <SubscriptionsModule
            subscriptions={subscriptions}
            bookings={bookings}
            payments={payments}
            customers={customers}
            ledger={ledger}
            attendance={attendance}
            bedsConfig={bedsConfig}
            rowsConfig={rowsConfig}
            pricingConfigs={pricingConfigs}
            subscriptionSetup={subscriptionSetup}
            priceList={priceList}
            onRefresh={() => {}} // real-time sync, no-op (A5)
            preSelectedSubId={preSelectedSubId}
            onClearPreSelectedSubId={() => setPreSelectedSubId(null)}
          />
        )}

        {activeTab === "cashier" && (
          <CashierModule
            currentDate={currentDate}
            bookings={bookings}
            tabs={tabs}
            payments={payments}
            pricingConfigs={pricingConfigs}
            bedsConfig={bedsConfig}
            rowsConfig={rowsConfig}
            onRefresh={() => {}} // real-time sync, no-op (A5)
          />
        )}

        {activeTab === "pricing" && (
          <PricingModule pricingConfigs={pricingConfigs} />
        )}

      </main>

      {/* 4. FOOTER */}
      <footer id="app-footer" className="bg-slate-100 border-t border-slate-200/50 py-4 text-center text-[10px] text-slate-400 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <span>© 2026 Lido Samarinda Fine Beach • Tutti i diritti riservati</span>
          <span>Sviluppato con React, Tailwind CSS, Node.js & Firebase Realtime Cloud</span>
        </div>
      </footer>

    </div>
  );
}
