import React, { useState, useEffect } from "react";
import { signInAnonymously } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { auth, db } from "./lib/firebase";
import { getRomeTodayString, formatItalianDate } from "./utils";
import { Booking, Tab, Payment, Subscription } from "./types";

// Import modules
import DailyMapModule from "./components/DailyMapModule";
import ScannerModule from "./components/ScannerModule";
import SubscriptionsModule from "./components/SubscriptionsModule";
import CashierModule from "./components/CashierModule";
import ClientView from "./components/ClientView"; // Vista Cliente pubblica (C)

// Icons
import { LayoutDashboard, QrCode, Users, Euro, Sparkles, Loader2, RefreshCw, Lock, LogOut, Globe } from "lucide-react";

type ActiveTab = "map" | "scanner" | "subscriptions" | "cashier";

export default function App() {
  const [currentDate, setCurrentDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("map");
  const [isAuth, setIsAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

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
        setAuthLoading(false);
      })
      .catch((error) => {
        console.warn("Firebase auth error (continuing with unauthenticated session):", error);
        setIsAuth(true);
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

    // Payments: load in realtime only those relevant for the active date (A3)
    // Filter by bookingId starting with currentDate YYYY-MM-DD
    const paymentsQuery = query(
      collection(db, "payments"),
      where("bookingId", ">=", currentDate),
      where("bookingId", "<=", currentDate + "\uf8ff")
    );
    const unsubscribePayments = onSnapshot(paymentsQuery, (snapshot) => {
      const list: Payment[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Payment);
      });
      setPayments(list);
    }, (err) => console.error("Payments sync error:", err));

    // Subscriptions: filter status == 'active' for the main view (A3)
    const subscriptionsQuery = query(
      collection(db, "subscriptions"),
      where("status", "==", "active")
    );
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

    return () => {
      unsubscribeBookings();
      unsubscribeTabs();
      unsubscribePayments();
      unsubscribeSubscriptions();
    };
  }, [isAuth, currentDate]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "samarinda2026") {
      setIsLoggedStaff(true);
      localStorage.setItem("samarinda_logged_staff", "true");
      setLoginError(null);
      setPassword("");
    } else {
      setLoginError("Password errata. Riprova.");
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

  // Public Client View (C)
  if (path !== "/gestione") {
    return <ClientView />;
  }

  // Staff Login Page (C)
  if (!isLoggedStaff) {
    return (
      <div id="login-container" className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-100 p-8 shadow-2xl flex flex-col gap-6">
          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-center tracking-widest text-lg"
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
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-500/10 transition-colors cursor-pointer text-sm"
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
    <div id="app-viewport" className="min-h-screen bg-slate-50/50 flex flex-col font-sans select-none antialiased">
      
      {/* 1. TOP NAV / HEADER */}
      <header id="app-header" className="bg-slate-900 text-white px-4 py-3 md:px-6 md:py-4 shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm md:text-base font-black tracking-tight uppercase">Samarinda Fine Beach</h1>
              <span className="text-[10px] text-blue-300 font-mono block">Gestionale Lido v2 • Santa Maria di Leuca</span>
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
              <span className="text-blue-200">{currentDate}</span>
            </div>
          </div>

        </div>
      </header>

      {/* 2. SUB HEADER TAB MENU */}
      <div id="app-tab-navigation" className="bg-white border-b border-slate-100 px-4 shadow-sm py-2 sticky top-14 md:top-16 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto gap-4">
          <div className="flex gap-1 md:gap-2">
            {[
              { id: "map", label: "Mappa Giornaliera", icon: LayoutDashboard },
              { id: "scanner", label: "Scanner Fogli", icon: QrCode },
              { id: "subscriptions", label: "Sezione Abbonati", icon: Users },
              { id: "cashier", label: "Cassa e Tab", icon: Euro }
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
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
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
      <main id="app-main-content" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        
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
            onRefresh={() => {}} // real-time sync, no-op (A5)
          />
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
