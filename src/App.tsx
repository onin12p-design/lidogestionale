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

// Icons
import { LayoutDashboard, QrCode, Users, Euro, Sparkles, Loader2, RefreshCw } from "lucide-react";

type ActiveTab = "map" | "scanner" | "subscriptions" | "cashier";

export default function App() {
  const [currentDate, setCurrentDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("map");
  const [isAuth, setIsAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Firestore Synced States
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loadingData, setLoadingData] = useState(true);

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
        console.error("Firebase auth error:", error);
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

    // Payments
    const paymentsQuery = query(collection(db, "payments"));
    const unsubscribePayments = onSnapshot(paymentsQuery, (snapshot) => {
      const list: Payment[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Payment);
      });
      setPayments(list);
    }, (err) => console.error("Payments sync error:", err));

    // Subscriptions
    const subscriptionsQuery = query(collection(db, "subscriptions"));
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

  const handleManualRefresh = () => {
    // Semplice trigger per forzare aggiornamento stati se necessario
    setCurrentDate((prev) => {
      const copy = prev;
      return "";
    });
    setTimeout(() => {
      setCurrentDate(getRomeTodayString());
    }, 50);
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

          {/* Sync indicator & Active Date */}
          <div className="flex items-center gap-3">
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

            <div className="h-4 w-px bg-slate-700"></div>

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
            onRefresh={handleManualRefresh}
          />
        )}

        {activeTab === "scanner" && (
          <ScannerModule
            currentDate={currentDate}
            existingBookings={bookings}
            onImportComplete={handleManualRefresh}
          />
        )}

        {activeTab === "subscriptions" && (
          <SubscriptionsModule
            subscriptions={subscriptions}
            bookings={bookings}
            payments={payments}
            onRefresh={handleManualRefresh}
          />
        )}

        {activeTab === "cashier" && (
          <CashierModule
            currentDate={currentDate}
            bookings={bookings}
            tabs={tabs}
            payments={payments}
            onRefresh={handleManualRefresh}
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
