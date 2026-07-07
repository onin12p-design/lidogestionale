import React, { useState } from "react";
import { Booking, Tab, Payment, PaymentMethod, PaymentKind, TabItem } from "../types";
import { getFirestore, setDoc, doc, collection, addDoc, getDocs, writeBatch, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { sanitizeForFirestore, getPriceForBooking, getBookingPriceProportional } from "../utils";
import { Coffee, CreditCard, Euro, CheckCircle, Search, Clock, AlertTriangle, Plus, Trash } from "lucide-react";

interface CashierModuleProps {
  currentDate: string;
  bookings: Booking[];
  tabs: Tab[];
  payments: Payment[];
  pricingConfigs?: any[];
  bedsConfig?: Record<number, number>;
  rowsConfig?: Record<number, number>;
  onRefresh: () => void;
}

export default function CashierModule({ currentDate, bookings, tabs, payments, pricingConfigs = [], bedsConfig = {}, rowsConfig = {}, onRefresh }: CashierModuleProps) {
  const [saving, setSaving] = useState(false);
  
  // Tab quick adding items
  const [selectedBookingForTab, setSelectedBookingForTab] = useState<Booking | null>(null);
  const [tabLabel, setTabLabel] = useState("");
  const [tabPrice, setTabPrice] = useState<number>(0);
  const [tabQty, setTabQty] = useState<number>(1);

  // Quick manual payment recording
  const [selectedBookingForPay, setSelectedBookingForPay] = useState<Booking | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payKind, setPayKind] = useState<PaymentKind>("full");
  const [payDiscount, setPayDiscount] = useState<number>(0);

  const isSubscriptionBooking = (b: Booking) => b.source === "subscription" || b.customerType === "subscriber" || b.tipoPrenotazione === "abbonato" || !!b.subscriptionId;

  // Helper to compute payment statistics for a booking
  const getBookingFinance = (booking: Booking) => {
    const bPayments = payments.filter((p) => p.bookingId === booking.id);
    const paidSum = bPayments.reduce((sum, p) => sum + p.amount, 0);

    let expectedPrice = booking.isHotel
      ? (paidSum > 0 ? paidSum : 0)
      : getBookingPriceProportional(booking, pricingConfigs, bedsConfig, rowsConfig);
    expectedPrice = Math.max(0, expectedPrice - ((booking as any).sconto || 0));
    const balance = booking.isHotel ? 0 : (expectedPrice - paidSum);

    let payStatus: "paid" | "partial" | "unpaid" | "hotel" = "unpaid";
    if (booking.isHotel) payStatus = "hotel";
    else if (paidSum >= expectedPrice) payStatus = "paid";
    else if (paidSum > 0) payStatus = "partial";

    return { paidSum, expectedPrice, balance, payStatus };
  };

  // 1. Riepilogo cassa giornaliero calculation (payments recorded today)
  const getDailySummary = () => {
    // Standard timestamp to Date check: we look at payments where date was created on "currentDate"
    // Since Firebase server timestamp is complex, let's filter payments that have a date field matching today or we can match payments created today
    const startOfToday = new Date(currentDate);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(currentDate);
    endOfToday.setHours(23, 59, 59, 999);

    const todayPayments = payments.filter((p) => {
      if (!p.date) return false;
      const d = p.date.seconds ? new Date(p.date.seconds * 1000) : new Date(p.date);
      return d >= startOfToday && d <= endOfToday;
    });

    const cashTotal = todayPayments.filter((p) => p.method === "cash").reduce((sum, p) => sum + p.amount, 0);
    const cardTotal = todayPayments.filter((p) => p.method === "card").reduce((sum, p) => sum + p.amount, 0);

    // Outstanding balances for today's bookings
    let pendingBeds = 0;
    bookings.forEach((b) => {
      if (isSubscriptionBooking(b) || b.isHotel) return;
      const { balance } = getBookingFinance(b);
      if (balance > 0) pendingBeds += balance;
    });

    // Unpaid tabs for today
    const unpaidTodayTabs = tabs.filter((t) => t.date === currentDate && !t.paid);
    const pendingTabs = unpaidTodayTabs.reduce((sum, t) => {
      const tabTotal = t.items.reduce((rowSum, item) => rowSum + item.price * item.qty, 0);
      return sum + tabTotal;
    }, 0);

    const hotelBookingsCount = bookings.filter((b) => b.isHotel).length;

    return {
      cashTotal,
      cardTotal,
      grandTotal: cashTotal + cardTotal,
      pendingBeds,
      pendingTabs,
      totalOutstanding: pendingBeds + pendingTabs,
      hotelBookingsCount
    };
  };

  const summary = getDailySummary();

  // 2. Build list of "Da incassare" (pending beds & tabs)
  const getPendingItemsList = () => {
    const list: {
      type: "bed" | "tab";
      bedNumber: number;
      label: string;
      customerName: string;
      amount: number;
      booking: Booking;
      tabRef?: Tab;
    }[] = [];

    // Pending bookings (unpaid or acconto)
    bookings.forEach((b) => {
      if (isSubscriptionBooking(b) || b.isHotel) return;
      const { balance, payStatus } = getBookingFinance(b);
      if (balance > 0) {
        list.push({
          type: "bed",
          bedNumber: b.bedNumber,
          label: payStatus === "partial" ? "Residuo Acconto" : "Prenotazione Intera",
          customerName: b.customerName,
          amount: balance,
          booking: b
        });
      }
    });

    // Unpaid tabs
    tabs.forEach((t) => {
      if (t.paid) return;
      const b = bookings.find((b) => b.id === t.bookingId);
      if (!b) return;

      const total = t.items.reduce((sum, item) => sum + item.price * item.qty, 0);
      if (total > 0) {
        list.push({
          type: "tab",
          bedNumber: t.bedNumber,
          label: "Consumazioni Aperte",
          customerName: b.customerName,
          amount: total,
          booking: b,
          tabRef: t
        });
      }
    });

    // Sort by bed number
    return list.sort((a, b) => a.bedNumber - b.bedNumber);
  };

  const pendingItems = getPendingItemsList();

  // Register payment for daily booking
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookingForPay || payAmount <= 0) return;

    setSaving(true);
    try {
      const paymentId = `pay_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, sanitizeForFirestore({
        customerId: selectedBookingForPay.customerId || "",
        bookingId: selectedBookingForPay.id,
        amount: payAmount,
        method: payMethod,
        kind: payKind,
        date: serverTimestamp(),
        operator: "Staff",
        dateStr: currentDate
      }));

      if (payDiscount > 0) {
        await setDoc(doc(db, "bookings", selectedBookingForPay.id), { sconto: payDiscount }, { merge: true });
        setPayDiscount(0);
      }

      setSelectedBookingForPay(null);
      setPayAmount(0);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Edit or add item to a bed's tab
  const handleAddTabItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookingForTab || !tabLabel.trim() || tabPrice <= 0) return;

    setSaving(true);
    try {
      const tabId = selectedBookingForTab.id; // Tab uses the same ID as Booking for 1:1 association
      const tabRef = doc(db, "tabs", tabId);

      // Find existing tab locally to check if there is one
      const existingTab = tabs.find((t) => t.bookingId === selectedBookingForTab.id);
      
      const newItems = existingTab ? [...existingTab.items] : [];
      newItems.push({
        label: tabLabel,
        price: tabPrice,
        qty: tabQty
      });

      await setDoc(tabRef, sanitizeForFirestore({
        bookingId: selectedBookingForTab.id,
        bedNumber: selectedBookingForTab.bedNumber,
        date: currentDate,
        items: newItems,
        paid: false
      }));

      setTabLabel("");
      setTabPrice(0);
      setTabQty(1);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Close tab and mark as paid (creates a cash/card payment too)
  const handleCloseTab = async (tab: Tab, method: PaymentMethod) => {
    setSaving(true);
    try {
      const tabRef = doc(db, "tabs", tab.bookingId);
      
      // Compute total tab amount
      const total = tab.items.reduce((sum, item) => sum + item.price * item.qty, 0);

      // 1. Mark Tab as paid
      await setDoc(tabRef, sanitizeForFirestore({
        ...tab,
        paid: true,
        paidMethod: method
      }));

      // 2. Write a payment for this tab
      const paymentId = `pay_tab_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, sanitizeForFirestore({
        bookingId: tab.bookingId,
        amount: total,
        method: method,
        kind: "full",
        date: serverTimestamp(),
        operator: "Staff",
        dateStr: currentDate
      }));

      setSelectedBookingForTab(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTabItem = async (tab: Tab, index: number) => {
    try {
      const tabRef = doc(db, "tabs", tab.bookingId);
      const updatedItems = tab.items.filter((_, idx) => idx !== index);

      await setDoc(tabRef, sanitizeForFirestore({
        ...tab,
        items: updatedItems
      }));

      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div id="cashier-root" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* 1. DAILY CASH SUMMARY & FINANCE STATS */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col justify-between h-full">
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Cassa Samarinda</h3>
            <p className="text-xs text-slate-500">Riepilogo incassi e contabilità per oggi ({currentDate}).</p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
              <span className="text-[10px] font-bold text-emerald-600 uppercase block mb-1">Incasso Contanti</span>
              <span className="text-xl font-black text-emerald-900">{summary.cashTotal} €</span>
            </div>

            <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
              <span className="text-[10px] font-bold text-blue-600 uppercase block mb-1">Incasso Carta/POS</span>
              <span className="text-xl font-black text-blue-900">{summary.cardTotal} €</span>
            </div>

            <div className="col-span-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Incasso Totale</span>
              <span className="text-2xl font-black text-slate-800">{summary.grandTotal} €</span>
            </div>
          </div>

          <div className="bg-rose-50/50 border border-rose-100 p-4 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-rose-600 uppercase block">In Attesa di Incasso</span>
            <div className="flex justify-between text-xs text-rose-800">
              <span>Lettini scoperti:</span>
              <span className="font-bold">{summary.pendingBeds} €</span>
            </div>
            <div className="flex justify-between text-xs text-rose-800">
              <span>Tab consumazioni aperti:</span>
              <span className="font-bold">{summary.pendingTabs} €</span>
            </div>
            <div className="border-t border-rose-200 pt-1.5 mt-1 flex justify-between text-sm text-rose-900 font-bold">
              <span>Totale da incassare:</span>
              <span>{summary.totalOutstanding} €</span>
            </div>
          </div>

          {summary.hotelBookingsCount > 0 && (
            <div className="bg-sky-50 border border-sky-100 p-4 rounded-xl flex justify-between items-center text-xs text-sky-800">
              <span className="font-bold uppercase tracking-wide text-[10px] text-sky-600">Hotel:</span>
              <span className="font-black text-sm text-sky-950">
                {summary.hotelBookingsCount} {summary.hotelBookingsCount === 1 ? "presenza" : "presenze"}
              </span>
            </div>
          )}
        </div>

        <div className="bg-slate-50 rounded-xl p-3 text-[10px] text-slate-400 mt-6 text-center">
          Tutte le transazioni sono sincronizzate in tempo reale sul cloud.
        </div>
      </div>

      {/* 2. VISTA "DA INCASSARE" FOR THE DAY */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col h-full min-h-[500px]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-800 uppercase tracking-wider">In Sospeso (Da Incassare)</h3>
            <p className="text-xs text-slate-500">Prenotazioni e tab aperti oggi, ordinati per numero lettino.</p>
          </div>
          <span className="bg-amber-100 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-full">
            {pendingItems.length} Sospesi
          </span>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[450px]">
          {pendingItems.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <CheckCircle className="w-12 h-12 mx-auto stroke-1 text-emerald-500 mb-2" />
              <p className="font-bold text-sm text-slate-700">Tutto saldato!</p>
              <p className="text-xs mt-1">Non ci sono lettini o tab in sospeso per oggi.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table id="pending-items-table" className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase text-[10px]">
                    <th className="p-3 w-16 text-center">Lettino</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Dettaglio Sospeso</th>
                    <th className="p-3 w-24 text-right">Importo</th>
                    <th className="p-3 w-40 text-center">Azioni Rapide</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {pendingItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3 text-center">
                        <span className="bg-blue-100 text-blue-900 font-mono font-bold px-2 py-0.5 rounded text-xs">
                          {item.bedNumber}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-slate-800">{item.customerName}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          item.type === "bed" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800"
                        }`}>
                          {item.type === "bed" ? "Lettino" : "Consumazione"}
                        </span>
                        <span className="text-slate-500 ml-2 text-xs">{item.label}</span>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900">{item.amount} €</td>
                      <td className="p-3 text-center flex gap-1.5 justify-center items-center">
                        {item.type === "bed" ? (
                          <button
                            id={`btn-pay-pending-${idx}`}
                            onClick={() => {
                              setSelectedBookingForPay(item.booking);
                              setPayAmount(item.amount);
                              setPayDiscount((item.booking as any).sconto || 0);
                            }}
                            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase px-2 py-1 rounded border border-emerald-200 transition-all"
                          >
                            Incassa
                          </button>
                        ) : (
                          <div className="flex gap-1">
                            <button
                              id={`btn-tab-cash-${idx}`}
                              onClick={() => handleCloseTab(item.tabRef!, "cash")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase px-1.5 py-1 rounded transition-all"
                            >
                              Contanti
                            </button>
                            <button
                              id={`btn-tab-card-${idx}`}
                              onClick={() => handleCloseTab(item.tabRef!, "card")}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase px-1.5 py-1 rounded transition-all"
                            >
                              POS
                            </button>
                          </div>
                        )}

                        <button
                          id={`btn-tab-edit-${idx}`}
                          onClick={() => setSelectedBookingForTab(item.booking)}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold uppercase px-1.5 py-1 rounded transition-all"
                          title="Gestisci Tab"
                        >
                          Dettagli
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAL / BOTTOM PANELS FOR MANAGING PAYMENT OR TAB */}
      {selectedBookingForPay && (
        <div id="modal-quick-pay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-bold text-slate-800 text-base">Registra Incasso Lettino {selectedBookingForPay.bedNumber}</h4>
                <p className="text-xs text-slate-400">Cliente: {selectedBookingForPay.customerName}</p>
              </div>
              <button
                id="btn-close-pay-modal"
                onClick={() => setSelectedBookingForPay(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form id="form-quick-pay" onSubmit={handleRecordPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Importo (€)</label>
                <input
                  id="pay-amount-quick"
                  type="number"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Sconto (€) — opzionale</label>
                <input
                  id="pay-discount-quick"
                  type="number"
                  value={payDiscount}
                  onChange={(e) => setPayDiscount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  placeholder="0"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Metodo</label>
                  <select
                    id="pay-method-quick"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    <option value="cash">Contanti</option>
                    <option value="card">Carta/POS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo Pagamento</label>
                  <select
                    id="pay-kind-quick"
                    value={payKind}
                    onChange={(e) => setPayKind(e.target.value as PaymentKind)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                  >
                    <option value="full">Saldo Intero</option>
                    <option value="deposit">Acconto</option>
                  </select>
                </div>
              </div>

              <button
                id="btn-quick-pay-submit"
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Conferma Pagamento {payAmount} €
              </button>
            </form>
          </div>
        </div>
      )}

      {selectedBookingForTab && (
        <div id="modal-quick-tab" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-bold text-slate-800 text-base">Consumazioni Lettino {selectedBookingForTab.bedNumber}</h4>
                <p className="text-xs text-slate-400">Cliente: {selectedBookingForTab.customerName}</p>
              </div>
              <button
                id="btn-close-tab-modal"
                onClick={() => setSelectedBookingForTab(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Quick add item form */}
            <form id="form-tab-add" onSubmit={handleAddTabItem} className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Aggiungi Voce</span>
              <div className="grid grid-cols-3 gap-2">
                <input
                  id="tab-label-input"
                  type="text"
                  required
                  placeholder="Es. Caffè"
                  value={tabLabel}
                  onChange={(e) => setTabLabel(e.target.value)}
                  className="col-span-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                />
                <input
                  id="tab-price-input"
                  type="number"
                  step="0.10"
                  required
                  placeholder="Prezzo"
                  value={tabPrice || ""}
                  onChange={(e) => setTabPrice(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                />
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-slate-500">Quantità:</span>
                  <input
                    id="tab-qty-input"
                    type="number"
                    min="1"
                    required
                    value={tabQty}
                    onChange={(e) => setTabQty(Number(e.target.value))}
                    className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-center font-bold"
                  />
                </div>
                <button
                  id="btn-add-tab-item-submit"
                  type="submit"
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
                >
                  Aggiungi
                </button>
              </div>
            </form>

            {/* Items list inside tab */}
            {(() => {
              const currentTab = tabs.find((t) => t.bookingId === selectedBookingForTab.id);
              const items = currentTab ? currentTab.items : [];
              const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);

              return (
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Articoli nel Tab</span>
                  {items.length === 0 ? (
                    <p className="text-center py-6 text-xs text-slate-400">Nessuna consumazione registrata.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg px-3">
                        {items.map((item, idx) => (
                          <div key={idx} className="py-2 flex justify-between items-center text-xs text-slate-700">
                            <div>
                              <span className="font-semibold">{item.label}</span>
                              <span className="text-slate-400 ml-1.5">x{item.qty}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{item.price * item.qty} €</span>
                              <button
                                id={`btn-del-tab-item-${idx}`}
                                type="button"
                                onClick={() => handleDeleteTabItem(currentTab!, idx)}
                                className="text-slate-400 hover:text-rose-600"
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 font-bold text-sm text-slate-800">
                        <span>Totale Tab:</span>
                        <span>{total} €</span>
                      </div>

                      {currentTab && !currentTab.paid && (
                        <div className="space-y-1.5 pt-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Scegli metodo per chiudere il Tab</span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              id="btn-tab-close-cash"
                              onClick={() => handleCloseTab(currentTab, "cash")}
                              className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1"
                            >
                              Chiudi con Contanti
                            </button>
                            <button
                              id="btn-tab-close-card"
                              onClick={() => handleCloseTab(currentTab, "card")}
                              className="py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1"
                            >
                              Chiudi con POS/Carta
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}
