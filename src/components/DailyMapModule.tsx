import React, { useState } from "react";
import { Booking, Tab, Payment, BookingSlot, CustomerType, PaymentMethod, PaymentKind } from "../types";
import { getFirestore, setDoc, doc, collection, writeBatch, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType, createBookingTransactional } from "../lib/firebase";
import { getRomeTodayString, adjustDateString, formatItalianDate, isValidBedNumber } from "../utils";
import BedMap from "./BedMap";
import { Calendar, ChevronLeft, ChevronRight, Search, Plus, Trash2, CreditCard, Coffee, Check, AlertCircle, Info, Users, Save, Clock } from "lucide-react";

interface DailyMapModuleProps {
  currentDate: string;
  onDateChange: (date: string) => void;
  bookings: Booking[];
  tabs: Tab[];
  payments: Payment[];
  onRefresh: () => void;
  selectedBed: number | null;
  setSelectedBed: (bed: number | null) => void;
  onOpenSubscriberCard?: (subId: string) => void;
}

export default function DailyMapModule({
  currentDate,
  onDateChange,
  bookings,
  tabs,
  payments,
  onRefresh,
  selectedBed,
  setSelectedBed,
  onOpenSubscriberCard
}: DailyMapModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Quick booking form state
  const [custName, setCustName] = useState("");
  const [custType, setCustType] = useState<CustomerType>("daily");
  const [bookSlot, setBookSlot] = useState<BookingSlot>("full_day");
  const [bookNotes, setBookNotes] = useState("");
  const [bookPrice, setBookPrice] = useState<number>(30); // estimated price

  // Quick payment form state
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payKind, setPayKind] = useState<PaymentKind>("full");

  // Tab quick item form state
  const [tabLabel, setTabLabel] = useState("");
  const [tabPrice, setTabPrice] = useState<number>(0);
  const [tabQty, setTabQty] = useState<number>(1);

  // Active editable notes state (B1)
  const [activeNotes, setActiveNotes] = useState<Record<string, string>>({});

  // Search Filtered Bookings & Beds
  const getFilteredBookings = () => {
    if (!searchQuery.trim()) return bookings;
    const query = searchQuery.toLowerCase();
    return bookings.filter(
      (b) =>
        b.customerName.toLowerCase().includes(query) ||
        b.bedNumber.toString() === query ||
        (b.notes && b.notes.toLowerCase().includes(query))
    );
  };

  const filteredBookings = getFilteredBookings();

  // Find bookings on the currently selected bed
  const getSelectedBedBookings = () => {
    if (selectedBed === null) return [];
    return bookings.filter((b) => b.bedNumber === selectedBed);
  };

  const selectedBedBookings = getSelectedBedBookings();

  // Find unpaid tab for the currently selected bed
  const getSelectedBedTab = () => {
    if (selectedBed === null) return null;
    return tabs.find((t) => t.bedNumber === selectedBed && !t.paid);
  };

  const selectedBedTab = getSelectedBedTab();

  // Check which slots are still free for the selected bed
  const getFreeSlotsForSelectedBed = () => {
    const activeSlots = selectedBedBookings.map((b) => b.slot);
    if (activeSlots.includes("full_day")) return [];
    
    const free: BookingSlot[] = [];
    if (!activeSlots.includes("morning")) free.push("morning");
    if (!activeSlots.includes("afternoon")) free.push("afternoon");
    
    // Only allow full_day if no slots are occupied
    if (activeSlots.length === 0) free.push("full_day");
    return free;
  };

  const freeSlots = getFreeSlotsForSelectedBed();

  // Auto set slot when selectedBed changes or slots computed, and sync active notes
  React.useEffect(() => {
    if (freeSlots.length > 0) {
      setBookSlot(freeSlots[0]);
      setBookPrice(freeSlots[0] === "full_day" ? 30 : 15);
    }
    
    // Synchronize interactive notes
    const notesMap: Record<string, string> = {};
    selectedBedBookings.forEach((b) => {
      notesMap[b.id] = b.notes || "";
    });
    setActiveNotes(notesMap);
  }, [selectedBed, bookings]);

  // Navigate dates
  const handlePrevDay = () => {
    onDateChange(adjustDateString(currentDate, -1));
    setSelectedBed(null);
  };

  const handleNextDay = () => {
    onDateChange(adjustDateString(currentDate, 1));
    setSelectedBed(null);
  };

  const handleToday = () => {
    onDateChange(getRomeTodayString());
    setSelectedBed(null);
  };

  // Perform quick booking (A1, A5)
  const handleQuickBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBed === null || !custName.trim()) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      // Create Customer document with standard secure ID (A5)
      const custId = doc(collection(db, "customers")).id;
      const customerRef = doc(db, "customers", custId);
      await setDoc(customerRef, {
        name: custName,
        type: custType,
        notes: bookNotes
      });

      // Use the transactional helper for double-booking protection (A1)
      const result = await createBookingTransactional({
        bedNumber: selectedBed,
        date: currentDate,
        slot: bookSlot,
        customerId: custId,
        customerName: custName,
        customerType: custType,
        source: "manual",
        notes: bookNotes
      });

      if (!result.success) {
        setErrorMessage(result.error || "Conflitto rilevato. Impossibile creare la prenotazione.");
        return;
      }

      // Reset form
      setCustName("");
      setBookNotes("");
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Errore nel salvare la prenotazione.");
    } finally {
      setSaving(false);
    }
  };

  // Record a payment
  const handleRecordPayment = async (bookingId: string, customerId?: string) => {
    if (payAmount <= 0) return;
    setSaving(true);

    try {
      const paymentId = `pay_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, {
        customerId: customerId || "",
        bookingId,
        amount: payAmount,
        method: payMethod,
        kind: payKind,
        date: serverTimestamp(),
        operator: "Staff"
      });

      setPayAmount(0);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Quick add item to tab
  const handleAddTabItem = async (bookingId: string) => {
    if (!tabLabel.trim() || tabPrice <= 0) return;
    setSaving(true);

    try {
      const tabId = bookingId;
      const tabRef = doc(db, "tabs", tabId);

      const existingItems = selectedBedTab ? [...selectedBedTab.items] : [];
      existingItems.push({
        label: tabLabel,
        price: tabPrice,
        qty: tabQty
      });

      await setDoc(tabRef, {
        bookingId,
        bedNumber: selectedBed!,
        date: currentDate,
        items: existingItems,
        paid: false
      });

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

  const handleCloseTab = async (tab: Tab, method: PaymentMethod) => {
    setSaving(true);
    try {
      const tabRef = doc(db, "tabs", tab.bookingId);
      const total = tab.items.reduce((sum, item) => sum + item.price * item.qty, 0);

      // Mark Tab as paid
      await setDoc(tabRef, {
        ...tab,
        paid: true,
        paidMethod: method
      });

      // Write payment
      const paymentId = `pay_tab_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, {
        bookingId: tab.bookingId,
        amount: total,
        method,
        kind: "full",
        date: serverTimestamp(),
        operator: "Staff"
      });

      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Cancel/Delete booking
  const handleCancelBooking = async (booking: Booking) => {
    if (!window.confirm(`Annullare la prenotazione del lettino ${booking.bedNumber} per ${booking.customerName}?`)) return;

    setSaving(true);
    try {
      // 1. Delete booking
      const bookingRef = doc(db, "bookings", booking.id);
      await deleteDoc(bookingRef);

      // 2. Also delete related tab if it exists
      const tabRef = doc(db, "tabs", booking.id);
      await deleteDoc(tabRef).catch(() => {}); // ignore error if tab didn't exist

      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Financial status helper for specific booking
  const getBookingFinances = (booking: Booking) => {
    const bPayments = payments.filter((p) => p.bookingId === booking.id);
    const paidSum = bPayments.reduce((sum, p) => sum + p.amount, 0);

    // If booking was generated from subscription, we check subscription payments too
    let isSub = booking.source === "subscription";
    let subPaid = 0;
    let subPrice = 0;
    
    if (isSub && booking.subscriptionId) {
      const sPayments = payments.filter((p) => p.subscriptionId === booking.subscriptionId);
      subPaid = sPayments.reduce((sum, p) => sum + p.amount, 0);
      // Retrieve price of subscription
      const parentSub = payments.find((p) => p.subscriptionId === booking.subscriptionId);
      subPrice = 30; // assume a fallback, but let's compute based on actual subscription model
    }

    const expectedPrice = booking.slot === "full_day" ? 30 : 15;
    const balance = expectedPrice - paidSum;

    let payStatus: "paid" | "partial" | "unpaid" = "unpaid";
    if (paidSum >= expectedPrice || (isSub && subPaid > 0)) {
      payStatus = paidSum >= expectedPrice ? "paid" : "partial";
    }

    return { paidSum, expectedPrice, balance, payStatus };
  };

  return (
    <div id="daily-map-module-root" className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
      
      {/* 3/4 COLUMN: CONTROLS & BED MAP */}
      <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-6">
        
        {/* Date Selector & Search bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              id="btn-prev-day"
              onClick={handlePrevDay}
              className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div className="flex flex-col items-center px-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mappa del Giorno</span>
              <span className="text-sm md:text-base font-black text-slate-800 text-center">{formatItalianDate(currentDate)}</span>
            </div>

            <button
              id="btn-next-day"
              onClick={handleNextDay}
              className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            <button
              id="btn-today"
              onClick={handleToday}
              className="px-3.5 py-2 text-xs font-bold text-blue-600 border border-blue-100 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors ml-2"
            >
              Oggi
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              id="map-search-input"
              type="text"
              placeholder="Cerca lettino, cliente, note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Real-time Bed Map Render */}
        <div className="border border-slate-50 p-4 rounded-2xl bg-slate-50/20">
          <BedMap
            bookings={filteredBookings}
            tabs={tabs}
            payments={payments}
            selectedBed={selectedBed}
            onBedSelect={(num) => setSelectedBed(num)}
          />
        </div>
      </div>

      {/* 1/4 COLUMN: TAP DETAILS PANEL */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm min-h-[500px]">
        {selectedBed !== null ? (
          <div id="bed-details-panel" className="space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dettaglio Lettino</span>
                <span className="text-xl font-black text-slate-800">Lettino {selectedBed}</span>
              </div>
              <button
                id="btn-close-details"
                onClick={() => setSelectedBed(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* If booked: show details */}
            {selectedBedBookings.length > 0 ? (
              <div className="space-y-6">
                {selectedBedBookings.map((booking) => {
                  const { paidSum, expectedPrice, balance, payStatus } = getBookingFinances(booking);

                  return (
                    <div key={booking.id} className="border border-slate-100 p-4 rounded-xl space-y-4 shadow-sm bg-slate-50/50">
                      
                      {/* Name & Badge */}
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm">{booking.customerName}</h4>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase mt-1 inline-block ${
                            booking.customerType === "subscriber" 
                              ? "bg-purple-100 text-purple-800" 
                              : "bg-emerald-100 text-emerald-800"
                          }`}>
                            {booking.customerType === "subscriber" ? "Abbonato" : "Giornaliero"}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 font-bold capitalize">
                          {booking.slot === "full_day" ? "Giornata Intera" : booking.slot === "morning" ? "Mattina" : "Pomeriggio"}
                        </span>
                      </div>

                      {/* Interactive Notes & Save (B1) */}
                      <div className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm">
                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Note del Lettino</span>
                        <div className="flex gap-1.5">
                          <textarea
                            id={`textarea-notes-bed-${booking.id}`}
                            rows={2}
                            placeholder="Aggiungi note per questo lettino..."
                            value={activeNotes[booking.id] || ""}
                            onChange={(e) => setActiveNotes(prev => ({ ...prev, [booking.id]: e.target.value }))}
                            className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-700 resize-none font-medium focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                          />
                          <button
                            id={`btn-save-notes-${booking.id}`}
                            onClick={async () => {
                              setSaving(true);
                              try {
                                const ref = doc(db, "bookings", booking.id);
                                await setDoc(ref, { notes: activeNotes[booking.id] || "" }, { merge: true });
                                onRefresh();
                              } catch (e) {
                                console.error(e);
                              } finally {
                                setSaving(false);
                              }
                            }}
                            disabled={saving || (activeNotes[booking.id] || "") === (booking.notes || "")}
                            className="px-2.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors flex items-center justify-center cursor-pointer"
                            title="Salva Note"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Link to subscriber (B1) */}
                      {booking.subscriptionId && onOpenSubscriberCard && (
                        <button
                          id={`btn-link-sub-${booking.id}`}
                          onClick={() => onOpenSubscriberCard(booking.subscriptionId!)}
                          className="w-full py-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-100 text-purple-700 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Vai alla card abbonato</span>
                        </button>
                      )}

                      {/* Finance info */}
                      <div className="space-y-2 border-t border-slate-200/50 pt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pagamenti</span>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Stato:</span>
                          {payStatus === "paid" ? (
                            <span className="text-emerald-600 font-bold">Saldato ({paidSum}€)</span>
                          ) : payStatus === "partial" ? (
                            <span className="text-amber-600 font-bold">Acconto (Residuo: {balance}€)</span>
                          ) : (
                            <span className="text-rose-500 font-bold">Non pagato (Costo: {expectedPrice}€)</span>
                          )}
                        </div>

                        {/* Quick record payment */}
                        {balance > 0 && booking.source !== "subscription" && (
                          <div className="bg-white p-2.5 rounded-lg border border-slate-100 space-y-2">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block">Registra Pagamento</span>
                            <div className="flex gap-1.5">
                              <input
                                id={`pay-amount-bed-${booking.id}`}
                                type="number"
                                placeholder="Euro (€)"
                                value={payAmount || ""}
                                onChange={(e) => setPayAmount(Number(e.target.value))}
                                max={balance}
                                className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-bold text-center"
                              />
                              <select
                                id={`pay-method-bed-${booking.id}`}
                                value={payMethod}
                                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                                className="px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                              >
                                <option value="cash">Contanti</option>
                                <option value="card">Carta</option>
                              </select>
                              <button
                                id={`btn-pay-bed-submit-${booking.id}`}
                                onClick={() => handleRecordPayment(booking.id, booking.customerId)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-2 py-1 rounded"
                              >
                                Vai
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Consumations / Tab */}
                      <div className="space-y-2 border-t border-slate-200/50 pt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tab Consumazioni</span>
                        
                        {/* If tab is active */}
                        {selectedBedTab ? (
                          <div className="space-y-2 text-xs">
                            <div className="max-h-24 overflow-y-auto divide-y divide-slate-100 bg-white border border-slate-100 rounded-lg px-2">
                              {selectedBedTab.items.map((it, idx) => (
                                <div key={idx} className="py-1 flex justify-between text-[11px] text-slate-600">
                                  <span>{it.label} x{it.qty}</span>
                                  <span className="font-bold">{it.price * it.qty}€</span>
                                </div>
                              ))}
                            </div>
                            
                            {/* Quick Close Tab */}
                            <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 font-bold">
                              <span>Totale:</span>
                              <span className="text-amber-700">
                                {selectedBedTab.items.reduce((sum, i) => sum + i.price * i.qty, 0)} €
                              </span>
                            </div>

                            <div className="flex gap-1">
                              <button
                                id={`btn-tab-close-cash-bed`}
                                onClick={() => handleCloseTab(selectedBedTab, "cash")}
                                className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase rounded"
                              >
                                Contanti
                              </button>
                              <button
                                id={`btn-tab-close-card-bed`}
                                onClick={() => handleCloseTab(selectedBedTab, "card")}
                                className="flex-1 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase rounded"
                              >
                                Carta
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-400 text-[10px] italic">Nessun tab di consumazione aperto.</p>
                        )}

                        {/* Add Quick item to tab */}
                        <div className="bg-white p-2.5 rounded-lg border border-slate-100 space-y-2">
                          <span className="text-[9px] font-bold text-slate-400 uppercase block">Aggiungi Drink / Consumazione</span>
                          <div className="flex gap-1.5">
                            <input
                              id={`tab-label-bed`}
                              type="text"
                              placeholder="Caffè..."
                              value={tabLabel}
                              onChange={(e) => setTabLabel(e.target.value)}
                              className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                            />
                            <input
                              id={`tab-price-bed`}
                              type="number"
                              placeholder="Prezzo (€)"
                              value={tabPrice || ""}
                              onChange={(e) => setTabPrice(Number(e.target.value))}
                              className="w-14 px-1 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-center font-bold"
                            />
                            <button
                              id={`btn-tab-add-bed-submit`}
                              onClick={() => handleAddTabItem(booking.id)}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-2 py-1 rounded"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Storico del Giorno (B1) */}
                      <div className="space-y-2 border-t border-slate-200/50 pt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Storico del Giorno
                        </span>
                        {(() => {
                          const events: string[] = [];
                          
                          events.push(`Prenotazione creata: ${booking.source === "subscription" ? "Abbonamento" : "Manuale"} (${booking.slot === "full_day" ? "Giornata Intera" : booking.slot === "morning" ? "Mattina" : "Pomeriggio"})`);
                          
                          // Payments for this booking
                          const directPayments = payments.filter(p => p.bookingId === booking.id);
                          directPayments.forEach(p => {
                            events.push(`Incasso: +${p.amount}€ via ${p.method === "cash" ? "Contanti" : "Carta"}`);
                          });

                          // Tab consumations
                          const matchingTab = tabs.find(t => t.bookingId === booking.id);
                          if (matchingTab) {
                            matchingTab.items.forEach(item => {
                              events.push(`Tab consumazione: +${item.label} x${item.qty} (${item.price * item.qty}€)`);
                            });
                            if (matchingTab.paid) {
                              events.push(`Tab saldato via ${matchingTab.paidMethod === "cash" ? "Contanti" : "Carta"}`);
                            }
                          }

                          if (events.length === 0) {
                            return <p className="text-slate-400 text-[10px] italic">Nessun movimento registrato.</p>;
                          }

                          return (
                            <ul className="text-[10px] text-slate-600 space-y-1 bg-white p-2 rounded-lg border border-slate-100 list-disc pl-4 font-medium shadow-sm">
                              {events.map((evt, eIdx) => (
                                <li key={eIdx}>{evt}</li>
                              ))}
                            </ul>
                          );
                        })()}
                      </div>

                      {/* Cancel Booking Action */}
                      <button
                        id={`btn-cancel-book-${booking.id}`}
                        onClick={() => handleCancelBooking(booking)}
                        className="w-full py-1.5 border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg transition-colors mt-2 cursor-pointer"
                      >
                        Cancella Prenotazione
                      </button>

                    </div>
                  );
                })}
              </div>
            ) : (
              // FREE BED: RENDER QUICK MANUAL BOOKING FORM
              <div className="space-y-4">
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 text-xs text-blue-800 space-y-1">
                  <span className="font-bold flex items-center gap-1">
                    <Info className="w-4 h-4" />
                    Lettino Disponibile!
                  </span>
                  <p>Puoi effettuare una prenotazione manuale rapida inserendo i dati sotto.</p>
                </div>

                <form id="form-quick-book" onSubmit={handleQuickBook} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Nome Cognome Cliente</label>
                    <input
                      id="book-cust-name"
                      type="text"
                      required
                      placeholder="Es. Mario Rossi"
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo Cliente</label>
                      <select
                        id="book-cust-type"
                        value={custType}
                        onChange={(e) => setCustType(e.target.value as CustomerType)}
                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      >
                        <option value="daily">Giornaliero</option>
                        <option value="subscriber">Abbonato</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Fascia Oraria</label>
                      <select
                        id="book-slot"
                        value={bookSlot}
                        onChange={(e) => {
                          setBookSlot(e.target.value as BookingSlot);
                          setBookPrice(e.target.value === "full_day" ? 30 : 15);
                        }}
                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      >
                        {freeSlots.map((s) => (
                          <option key={s} value={s}>
                            {s === "full_day" ? "Giornata Intera" : s === "morning" ? "Mattina (AM)" : "Pomeriggio (PM)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Note / Richieste</label>
                    <input
                      id="book-notes"
                      type="text"
                      placeholder="Es. Ombra desiderata..."
                      value={bookNotes}
                      onChange={(e) => setBookNotes(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500"
                    />
                  </div>

                  <button
                    id="btn-quick-book-submit"
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors uppercase tracking-wider"
                  >
                    Effettua Prenotazione
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-24 text-slate-400 flex-1 flex flex-col justify-center items-center">
            <Info className="w-10 h-10 mx-auto stroke-1 text-slate-300 mb-2" />
            <p className="font-bold text-sm text-slate-500">Seleziona un Lettino</p>
            <p className="text-xs">Fai tap su un lettino nella mappa per effettuare prenotazioni manuali, inserire consumazioni o registrare pagamenti.</p>
          </div>
        )}
      </div>

    </div>
  );
}
