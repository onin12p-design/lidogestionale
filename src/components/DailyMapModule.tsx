import React, { useState } from "react";
import { Booking, Tab, Payment, BookingSlot, CustomerType, PaymentMethod, PaymentKind } from "../types";
import { getFirestore, setDoc, doc, collection, writeBatch, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType, createBookingTransactional } from "../lib/firebase";
import { getRomeTodayString, adjustDateString, formatItalianDate, isValidBedNumber, sanitizeForFirestore, getPriceForBooking } from "../utils";
import BedMap, { PEDANA_SINISTRA_LEFT, PEDANA_SINISTRA_RIGHT, PEDANA_DESTRA_LEFT, PEDANA_DESTRA_RIGHT } from "./BedMap";
import { Calendar, ChevronLeft, ChevronRight, Search, Plus, Trash2, CreditCard, Coffee, Check, AlertCircle, Info, Users, Save, Clock, Printer, X, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import ConfirmationModal from "./ConfirmationModal";

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
  pricingConfigs?: any[];
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
  onOpenSubscriberCard,
  pricingConfigs = []
}: DailyMapModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null);

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
      setBookPrice(selectedBed !== null ? getPriceForBooking(currentDate, selectedBed, freeSlots[0], pricingConfigs) : (freeSlots[0] === "full_day" ? 30 : 15));
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
      await setDoc(customerRef, sanitizeForFirestore({
        name: custName,
        type: custType,
        notes: bookNotes
      }));

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

      await setDoc(paymentRef, sanitizeForFirestore({
        customerId: customerId || "",
        bookingId,
        amount: payAmount,
        method: payMethod,
        kind: payKind,
        date: serverTimestamp(),
        operator: "Staff"
      }));

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

      await setDoc(tabRef, sanitizeForFirestore({
        bookingId,
        bedNumber: selectedBed!,
        date: currentDate,
        items: existingItems,
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

  const handleCloseTab = async (tab: Tab, method: PaymentMethod) => {
    setSaving(true);
    try {
      const tabRef = doc(db, "tabs", tab.bookingId);
      const total = tab.items.reduce((sum, item) => sum + item.price * item.qty, 0);

      // Mark Tab as paid
      await setDoc(tabRef, sanitizeForFirestore({
        ...tab,
        paid: true,
        paidMethod: method
      }));

      // Write payment
      const paymentId = `pay_tab_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, sanitizeForFirestore({
        bookingId: tab.bookingId,
        amount: total,
        method,
        kind: "full",
        date: serverTimestamp(),
        operator: "Staff"
      }));

      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Cancel/Delete booking trigger
  const triggerCancelBooking = (booking: Booking) => {
    setBookingToDelete(booking);
    setConfirmDeleteOpen(true);
  };

  const handleCancelBookingConfirm = async () => {
    if (!bookingToDelete) return;
    setConfirmDeleteOpen(false);
    setSaving(true);
    setErrorMessage(null);
    try {
      // 1. Delete booking
      const bookingRef = doc(db, "bookings", bookingToDelete.id);
      await deleteDoc(bookingRef);

      // 2. Also delete related tab if it exists
      const tabRef = doc(db, "tabs", bookingToDelete.id);
      await deleteDoc(tabRef).catch(() => {}); // ignore error if tab didn't exist

      onRefresh();
      setBookingToDelete(null);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Errore durante la cancellazione della prenotazione.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllBookingsConfirm = async () => {
    setConfirmDeleteAllOpen(false);
    if (bookings.length === 0) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const batch = writeBatch(db);

      bookings.forEach((booking) => {
        // Delete booking
        const bookingRef = doc(db, "bookings", booking.id);
        batch.delete(bookingRef);

        // Delete tab if any
        const tabRef = doc(db, "tabs", booking.id);
        batch.delete(tabRef);
      });

      await batch.commit();
      setSelectedBed(null);
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Errore durante la cancellazione di tutte le prenotazioni.");
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

    const expectedPrice = getPriceForBooking(booking.date, booking.bedNumber, booking.slot, pricingConfigs);
    const balance = expectedPrice - paidSum;

    let payStatus: "paid" | "partial" | "unpaid" = "unpaid";
    if (paidSum >= expectedPrice || (isSub && subPaid > 0)) {
      payStatus = paidSum >= expectedPrice ? "paid" : "partial";
    }

    return { paidSum, expectedPrice, balance, payStatus };
  };

  return (
    <div id="daily-map-module-root" className={`grid grid-cols-1 ${isExpanded ? "xl:grid-cols-1" : "xl:grid-cols-4"} gap-6 items-start transition-all duration-300`}>
      
      {/* 3/4 COLUMN: CONTROLS & BED MAP (BECOMES FULL WIDTH WHEN EXPANDED) */}
      <div className={`${isExpanded ? "w-full" : "xl:col-span-3"} bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-6`}>
        
        {/* Date Selector & Search bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="btn-prev-day"
              onClick={handlePrevDay}
              className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
              title="Giorno Precedente"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 rounded-xl px-3.5 py-1.5 transition-all relative shadow-inner">
              <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-tight">Data Attiva (Salto Rapido)</span>
                <input
                  id="datepicker-current-date"
                  type="date"
                  min="2026-01-01"
                  max="2026-12-31"
                  value={currentDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      onDateChange(e.target.value);
                    }
                  }}
                  className="bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none cursor-pointer p-0 h-5"
                />
              </div>
            </div>

            <button
              id="btn-next-day"
              onClick={handleNextDay}
              className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
              title="Giorno Successivo"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            <button
              id="btn-today"
              onClick={handleToday}
              className="px-4 py-2.5 text-xs font-bold text-blue-600 border border-blue-100 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors shadow-sm"
            >
              Oggi
            </button>

            <div className="text-xs font-extrabold text-slate-600 bg-slate-100/80 px-3.5 py-2.5 rounded-xl border border-slate-200/60 shadow-sm">
              {formatItalianDate(currentDate)}
            </div>
          </div>

          {/* Quick Search and Print Map */}
          <div className="flex items-center gap-2.5 w-full md:w-auto">
            <div className="relative w-full md:w-60">
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

            <button
              id="btn-print-map"
              onClick={() => setIsPrintModalOpen(true)}
              className="px-4 py-2 bg-[#025A70]/10 hover:bg-[#025A70]/20 text-[#025A70] font-black text-xs rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer shrink-0 border border-[#025A70]/10 h-9"
              title="Stampa mappa e lista prenotazioni del giorno"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Stampa Mappa</span>
            </button>

            <button
              id="btn-clear-all-today"
              onClick={() => setConfirmDeleteAllOpen(true)}
              disabled={bookings.length === 0}
              className={`px-4 py-2 ${
                bookings.length === 0 
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200" 
                  : "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200"
              } font-black text-xs rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer shrink-0 border h-9`}
              title="Svuota tutte le prenotazioni odierne"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Svuota Odierne</span>
            </button>

            <button
              id="btn-toggle-expand-map"
              onClick={() => setIsExpanded(!isExpanded)}
              className={`px-4 py-2 ${isExpanded ? "bg-amber-100/80 hover:bg-amber-200 text-amber-800" : "bg-[#025A70]/10 hover:bg-[#025A70]/20 text-[#025A70]"} font-black text-xs rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer shrink-0 border ${isExpanded ? "border-amber-200" : "border-[#025A70]/10"} h-9`}
              title={isExpanded ? "Comprimi mappa alla larghezza normale" : "Espandi mappa alla massima larghezza per visualizzazione grande"}
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Comprimi</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Espandi Mappa</span>
                </>
              )}
            </button>
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
            isExpanded={isExpanded}
            pricingConfigs={pricingConfigs}
          />
        </div>
      </div>

      {/* 1/4 COLUMN: TAP DETAILS PANEL */}
      <div className={`bg-white rounded-2xl border border-slate-100 p-6 shadow-sm min-h-[500px] ${isExpanded ? "xl:max-w-4xl xl:mx-auto xl:w-full" : ""}`}>
        {errorMessage && (
          <div className="bg-rose-50 border border-rose-100 p-3.5 rounded-xl text-xs text-rose-700 font-bold flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <div className="flex-1">{errorMessage}</div>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-600 font-bold ml-1">✕</button>
          </div>
        )}
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

            {/* Active Bookings section (if any) */}
            {selectedBedBookings.length > 0 && (
              <div className="space-y-4">
                <span className="text-[10px] font-extrabold text-[#025A70] uppercase tracking-wider block">
                  Prenotazioni Attive ({selectedBedBookings.length})
                </span>
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
                                  await setDoc(ref, sanitizeForFirestore({ notes: activeNotes[booking.id] || "" }), { merge: true });
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
                          onClick={() => triggerCancelBooking(booking)}
                          className="w-full py-1.5 border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold rounded-lg transition-colors mt-2 cursor-pointer"
                        >
                          Cancella Prenotazione
                        </button>

                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* If there are free slots: show booking form for remaining slots */}
            {freeSlots.length > 0 ? (
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <span className="text-[10px] font-extrabold text-[#025A70] uppercase tracking-wider block">
                  {selectedBedBookings.length > 0 ? "Aggiungi Prenotazione per Turno Libero" : "Nuova Prenotazione"}
                </span>
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 text-xs text-blue-800 space-y-1">
                  <span className="font-bold flex items-center gap-1">
                    <Info className="w-4 h-4" />
                    Turni Disponibili!
                  </span>
                  <p>Puoi effettuare una prenotazione manuale rapida per i turni liberi.</p>
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
                          const s = e.target.value as BookingSlot;
                          setBookSlot(s);
                          setBookPrice(selectedBed !== null ? getPriceForBooking(currentDate, selectedBed, s, pricingConfigs) : (s === "full_day" ? 30 : 15));
                        }}
                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#025A70] border-[#025A70]/20 bg-emerald-50/30"
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
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors uppercase tracking-wider cursor-pointer"
                  >
                    Effettua Prenotazione
                  </button>
                </form>
              </div>
            ) : (
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100/50 text-xs text-amber-800 space-y-1 pt-4 border-t border-slate-100">
                <span className="font-bold flex items-center gap-1">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  Lettino Completamente Occupato
                </span>
                <p>Tutti i turni (Mattina e Pomeriggio o Giornata Intera) sono prenotati.</p>
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

      <ConfirmationModal
        isOpen={confirmDeleteOpen}
        title="Annulla Prenotazione"
        message={bookingToDelete ? `Annullare la prenotazione del lettino ${bookingToDelete.bedNumber} per ${bookingToDelete.customerName}?` : ""}
        confirmLabel="Annulla Prenotazione"
        cancelLabel="Indietro"
        isDestructive={true}
        onConfirm={handleCancelBookingConfirm}
        onCancel={() => {
          setConfirmDeleteOpen(false);
          setBookingToDelete(null);
        }}
      />

      <ConfirmationModal
        isOpen={confirmDeleteAllOpen}
        title="Annulla Tutte le Prenotazioni"
        message={`Sei sicuro di voler cancellare TUTTE le ${bookings.length} prenotazioni del giorno ${formatItalianDate(currentDate)}? Questa operazione svuoterà la mappa ed eliminerà anche tutte le consumazioni associate.`}
        confirmLabel="Sì, Svuota Tutto"
        cancelLabel="Annulla"
        isDestructive={true}
        onConfirm={handleDeleteAllBookingsConfirm}
        onCancel={() => setConfirmDeleteAllOpen(false)}
      />

      {/* PRINTABLE MAP MODAL OVERLAY */}
      {isPrintModalOpen && (
        <div id="print-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex flex-col p-4 md:p-8 overflow-y-auto print:static print:block print:p-0 print:m-0 print:bg-white print:overflow-visible print:h-auto print:w-full">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              html, body, #root {
                height: auto !important;
                overflow: visible !important;
                position: static !important;
              }
              body * {
                visibility: hidden !important;
              }
              #print-modal-overlay, #print-preview-document, #print-preview-document * {
                visibility: visible !important;
              }
              #print-modal-overlay {
                position: static !important;
                display: block !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
                height: auto !important;
                width: 100% !important;
                background: white !important;
              }
              #print-preview-document {
                position: static !important;
                display: block !important;
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
                background: white !important;
                color: black !important;
                padding: 0 !important;
                margin: 0 !important;
                box-shadow: none !important;
              }
            }
          `}} />

          {/* Action Header - Hidden during actual print */}
          <div className="bg-white rounded-t-2xl border-b border-slate-100 p-4 max-w-5xl w-full mx-auto flex items-center justify-between shadow-sm print:hidden">
            <div className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-[#025A70]" />
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Anteprima di Stampa Mappa</h3>
                <p className="text-[10px] text-slate-400 font-medium">Ottimizzato per foglio A4 (Usa orientamento Landscape/Orizzontale per la resa migliore)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                id="btn-trigger-browser-print"
                onClick={() => {
                  try {
                    window.focus();
                    window.print();
                  } catch (e) {
                    console.error("Print error:", e);
                  }
                }}
                className="px-4 py-2 bg-[#025A70] hover:bg-[#02586e] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Stampa Ora (PDF/Carta)</span>
              </button>
              <button
                id="btn-close-print-modal"
                onClick={() => setIsPrintModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Iframe sandbox warning banner - Hidden during actual print */}
          {typeof window !== "undefined" && window.self !== window.top && (
            <div className="bg-amber-50 border-x border-b border-amber-100 p-4 max-w-5xl w-full mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner print:hidden">
              <div className="flex items-start gap-2.5 text-amber-800 text-xs font-semibold">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-extrabold text-amber-900 uppercase tracking-wider text-[11px]">Avviso Anteprima Protetta</p>
                  <p className="leading-relaxed text-slate-600 font-medium">
                    I browser moderni bloccano l'apertura della finestra di stampa (<code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-900">window.print()</code>) quando l'applicazione è incorporata all'interno dell'anteprima di AI Studio.
                  </p>
                  <p className="leading-relaxed text-slate-600 font-bold">
                    Per stampare correttamente, fai clic sul pulsante a destra "Apri in Nuova Scheda" per caricare l'applicazione a schermo intero!
                  </p>
                </div>
              </div>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0 uppercase tracking-wider cursor-pointer no-underline text-center"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Apri in Nuova Scheda</span>
              </a>
            </div>
          )}

          {/* Printable Document Area */}
          <div id="print-preview-document" className="bg-white p-6 md:p-10 max-w-5xl w-full mx-auto rounded-b-2xl shadow-lg text-black print:shadow-none print:p-0 print:m-0">
            {/* Header */}
            <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-end">
              <div>
                <h1 className="text-xl font-extrabold tracking-wide uppercase">STABILIMENTO BALNEARE SAMARINDA</h1>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mt-0.5">PIANO DELLA SPIAGGIA E REGISTRO PRENOTAZIONI</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Giorno di Riferimento</span>
                <span className="text-sm font-black text-black bg-slate-100/60 px-2 py-1 rounded border border-slate-200 uppercase print:bg-white print:border-none print:p-0">{formatItalianDate(currentDate)}</span>
              </div>
            </div>

            {/* Micro instructions / Legend */}
            <div className="grid grid-cols-4 gap-4 mb-6 text-[10px] bg-slate-50 p-3 rounded-xl border border-slate-100 print:bg-white print:border-black print:rounded-none">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-black inline-block bg-white text-center font-extrabold text-[8px]">AM</span>
                <span>Mattina (Solo mattina prenotata)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-black inline-block bg-white text-center font-extrabold text-[8px]">PM</span>
                <span>Pomeriggio (Solo pomeriggio prenotato)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-black inline-block bg-white text-center font-extrabold text-[8px]">G</span>
                <span>Giornata Intera (Occupato tutto il giorno)</span>
              </div>
              <div className="text-right text-slate-500 flex items-center justify-end gap-1 font-medium">
                <span>Prenotazioni attive: <strong>{bookings.length}</strong></span>
              </div>
            </div>

            {/* Grid Map Layout */}
            <div className="space-y-6">
              
              {/* PEDANA SINISTRA */}
              <div className="border border-black p-4 bg-white">
                <h3 className="text-xs font-black uppercase text-center mb-3 tracking-wider border-b border-black pb-1">PEDANA SINISTRA</h3>
                <div className="grid grid-cols-2 gap-4">
                  
                  {/* Griglia Sinistra */}
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold uppercase block text-center text-slate-500">Griglia Sinistra (1-34)</span>
                    <div className="grid grid-cols-5 gap-1">
                      {PEDANA_SINISTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => {
                        if (bedNum === null) return <div key={`print-ps-left-null-${idx}`} className="h-10 border border-transparent"></div>;
                        const bList = bookings.filter((b) => b.bedNumber === bedNum);
                        return (
                          <div key={`print-ps-left-${bedNum}`} className="border border-black p-0.5 text-center flex flex-col justify-between h-10 bg-white">
                            <span className="text-[10px] font-black leading-none">{bedNum}</span>
                            {bList.length > 0 ? (
                              <div className="text-[6.5px] font-extrabold truncate uppercase leading-none text-slate-800">
                                {bList.map((b) => (
                                  <div key={b.id} className="truncate">
                                    {b.slot === "morning" ? "M:" : b.slot === "afternoon" ? "P:" : "G:"}{b.customerName.split(" ")[0] || b.customerName}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[6px] text-slate-300 font-medium tracking-tighter leading-none">LIBERO</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Griglia Destra */}
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold uppercase block text-center text-slate-500">Griglia Destra (6-30)</span>
                    <div className="grid grid-cols-5 gap-1">
                      {PEDANA_SINISTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => {
                        if (bedNum === null) return <div key={`print-ps-right-null-${idx}`} className="h-10 border border-transparent"></div>;
                        const bList = bookings.filter((b) => b.bedNumber === bedNum);
                        return (
                          <div key={`print-ps-right-${bedNum}`} className="border border-black p-0.5 text-center flex flex-col justify-between h-10 bg-white">
                            <span className="text-[10px] font-black leading-none">{bedNum}</span>
                            {bList.length > 0 ? (
                              <div className="text-[6.5px] font-extrabold truncate uppercase leading-none text-slate-800">
                                {bList.map((b) => (
                                  <div key={b.id} className="truncate">
                                    {b.slot === "morning" ? "M:" : b.slot === "afternoon" ? "P:" : "G:"}{b.customerName.split(" ")[0] || b.customerName}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[6px] text-slate-300 font-medium tracking-tighter leading-none">LIBERO</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>

              {/* PEDANA DESTRA */}
              <div className="border border-black p-4 bg-white">
                <h3 className="text-xs font-black uppercase text-center mb-3 tracking-wider border-b border-black pb-1">PEDANA DESTRA</h3>
                <div className="grid grid-cols-2 gap-4">
                  
                  {/* Griglia Sinistra */}
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold uppercase block text-center text-slate-500">Griglia Sinistra (60-97)</span>
                    <div className="grid grid-cols-5 gap-1">
                      {PEDANA_DESTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => {
                        if (bedNum === null) return <div key={`print-pd-left-null-${idx}`} className="h-10 border border-transparent"></div>;
                        const bList = bookings.filter((b) => b.bedNumber === bedNum);
                        return (
                          <div key={`print-pd-left-${bedNum}`} className="border border-black p-0.5 text-center flex flex-col justify-between h-10 bg-white">
                            <span className="text-[10px] font-black leading-none">{bedNum}</span>
                            {bList.length > 0 ? (
                              <div className="text-[6.5px] font-extrabold truncate uppercase leading-none text-slate-800">
                                {bList.map((b) => (
                                  <div key={b.id} className="truncate">
                                    {b.slot === "morning" ? "M:" : b.slot === "afternoon" ? "P:" : "G:"}{b.customerName.split(" ")[0] || b.customerName}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[6px] text-slate-300 font-medium tracking-tighter leading-none">LIBERO</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Griglia Destra */}
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold uppercase block text-center text-slate-500">Griglia Destra (65-109)</span>
                    <div className="grid grid-cols-6 gap-1">
                      {PEDANA_DESTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => {
                        if (bedNum === null) return <div key={`print-pd-right-null-${idx}`} className="h-10 border border-transparent"></div>;
                        const bList = bookings.filter((b) => b.bedNumber === bedNum);
                        return (
                          <div key={`print-pd-right-${bedNum}`} className="border border-black p-0.5 text-center flex flex-col justify-between h-10 bg-white">
                            <span className="text-[10px] font-black leading-none">{bedNum}</span>
                            {bList.length > 0 ? (
                              <div className="text-[6.5px] font-extrabold truncate uppercase leading-none text-slate-800">
                                {bList.map((b) => (
                                  <div key={b.id} className="truncate">
                                    {b.slot === "morning" ? "M:" : b.slot === "afternoon" ? "P:" : "G:"}{b.customerName.split(" ")[0] || b.customerName}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[6px] text-slate-300 font-medium tracking-tighter leading-none">LIBERO</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>

            </div>

            {/* List Table underneath */}
            <div className="mt-8 border-t border-black pt-4">
              <h4 className="text-xs font-black uppercase mb-3 tracking-wider">REGISTRO ANALITICO PRENOTAZIONI ({bookings.length} POSIZIONI)</h4>
              <table className="w-full text-left text-[9px] border-collapse border border-black">
                <thead>
                  <tr className="bg-slate-100 border-b border-black">
                    <th className="py-1 px-2 border-r border-black font-extrabold w-12 text-center">LETTINO</th>
                    <th className="py-1 px-2 border-r border-black font-extrabold">NOME CLIENTE</th>
                    <th className="py-1 px-2 border-r border-black font-extrabold w-20 text-center">SLOT</th>
                    <th className="py-1 px-2 border-r border-black font-extrabold w-16 text-center">TIPO</th>
                    <th className="py-1 px-2 border-r border-black font-extrabold w-36">PAGATO (METODO)</th>
                    <th className="py-1 px-2 border-r border-black font-extrabold w-20 text-right">DA PAGARE</th>
                    <th className="py-1 px-2 font-extrabold">NOTE ED EVENTUALI DETTAGLI</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-slate-400 italic">Nessun lettino occupato in data odierna.</td>
                    </tr>
                  ) : (
                    [...bookings]
                      .sort((a, b) => a.bedNumber - b.bedNumber)
                      .map((b) => {
                        const isSubscriber = b.customerType === "subscriber";
                        const bPayments = payments.filter((p) => p.bookingId === b.id);
                        const totalPaid = bPayments.reduce((sum, p) => sum + p.amount, 0);
                        const expected = getPriceForBooking(b.date, b.bedNumber, b.slot, pricingConfigs);
                        const remaining = Math.max(0, expected - totalPaid);
                        
                        const paymentDetails = isSubscriber 
                          ? "-" 
                          : bPayments.length > 0 
                            ? bPayments.map((p) => {
                                const methodMap: Record<string, string> = {
                                  cash: "Contanti",
                                  pos: "POS",
                                  bank: "Bonifico",
                                  other: "Altro",
                                  subscription: "Abbonamento"
                                };
                                return `${p.amount}€ (${methodMap[p.method] || p.method})`;
                              }).join(", ")
                            : "Nessuno";

                        const daPagareText = isSubscriber 
                          ? "-" 
                          : remaining === 0 
                            ? "PAGATO" 
                            : `${remaining.toFixed(2)}€`;

                        return (
                          <tr key={b.id} className="border-b border-black/50 hover:bg-slate-50">
                            <td className="py-1 px-2 border-r border-black font-extrabold text-center">{b.bedNumber}</td>
                            <td className="py-1 px-2 border-r border-black font-bold uppercase">{b.customerName}</td>
                            <td className="py-1 px-2 border-r border-black font-semibold uppercase text-center">{b.slot === "full_day" ? "Intero (G)" : b.slot === "morning" ? "Mattina (M)" : "Pomeriggio (P)"}</td>
                            <td className="py-1 px-2 border-r border-black font-medium text-center">{isSubscriber ? "Abbonato" : "Giornaliero"}</td>
                            <td className="py-1 px-2 border-r border-black font-medium text-slate-800">{paymentDetails}</td>
                            <td className={`py-1 px-2 border-r border-black font-bold text-right ${remaining > 0 && !isSubscriber ? "text-red-600" : "text-emerald-700"}`}>
                              {daPagareText}
                            </td>
                            <td className="py-1 px-2 text-slate-700">{b.notes || "-"}</td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-black text-[8px] text-slate-400 flex justify-between uppercase tracking-wider font-semibold">
              <span>Stampato il {new Date().toLocaleDateString("it-IT")}</span>
              <span>Samarinda Beach Management System</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
