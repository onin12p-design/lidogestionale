import React, { useState, useEffect } from "react";
import { Subscription, Booking, Customer, Payment, BookingSlot, SubscriptionStatus, PaymentMethod, PaymentKind } from "../types";
import { getFirestore, setDoc, doc, collection, addDoc, getDocs, query, where, writeBatch, serverTimestamp, deleteDoc, onSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType, createBookingTransactional } from "../lib/firebase";
import { getRomeTodayString, adjustDateString, formatItalianDate, isValidBedNumber, sanitizeForFirestore } from "../utils";
import { UserPlus, Calendar, Plus, Trash2, ShieldAlert, CreditCard, CheckCircle, Clock, AlertCircle, Save } from "lucide-react";
import ConfirmationModal from "./ConfirmationModal";

interface SubscriptionsModuleProps {
  subscriptions: Subscription[];
  bookings: Booking[];
  payments: Payment[];
  onRefresh: () => void;
  preSelectedSubId?: string | null;
  onClearPreSelectedSubId?: () => void;
}

export default function SubscriptionsModule({
  subscriptions,
  bookings,
  payments,
  onRefresh,
  preSelectedSubId,
  onClearPreSelectedSubId
}: SubscriptionsModuleProps) {
  const [activeTab, setActiveTab] = useState<"list" | "new">("list");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictsList, setConflictsList] = useState<{ date: string; bedNumber: number; slot: BookingSlot; customer: string }[]>([]);

  const [confirmDeleteSubOpen, setConfirmDeleteSubOpen] = useState(false);
  const [subToDelete, setSubToDelete] = useState<Subscription | null>(null);

  // Form states
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [bedNumbersInput, setBedNumbersInput] = useState("");
  const [startDate, setStartDate] = useState(getRomeTodayString());
  const [endDate, setEndDate] = useState(adjustDateString(getRomeTodayString(), 7));
  const [slot, setSlot] = useState<BookingSlot>("full_day");
  const [priceTotal, setPriceTotal] = useState<number>(150);
  const [selectedDays, setSelectedDays] = useState<number[]>([]); // empty = all days

  // Detail panel state
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payKind, setPayKind] = useState<PaymentKind>("full");

  // Subscriber live editable notes (B2)
  const [subNotes, setSubNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Payments loaded on-demand for the selected subscriber (A3, B2)
  const [selectedSubPayments, setSelectedSubPayments] = useState<Payment[]>([]);

  // Listen to selected subscriber payments on-demand (A3, B2)
  useEffect(() => {
    if (!selectedSub || !selectedSub.id) {
      setSelectedSubPayments([]);
      return;
    }
    const q = query(
      collection(db, "payments"),
      where("subscriptionId", "==", selectedSub.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Payment[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Payment);
      });
      setSelectedSubPayments(list);
    }, (err) => console.error("On-demand sub payments error:", err));
    return () => unsubscribe();
  }, [selectedSub]);

  // Cancelled subscriptions loaded on-demand for history (A3)
  const [cancelledSubs, setCancelledSubs] = useState<Subscription[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loadingCancelled, setLoadingCancelled] = useState(false);

  // Fetch cancelled subscriptions on-demand (A3)
  useEffect(() => {
    if (showCancelled) {
      setLoadingCancelled(true);
      const q = query(
        collection(db, "subscriptions"),
        where("status", "==", "cancelled")
      );
      getDocs(q)
        .then((snapshot) => {
          const list: Subscription[] = [];
          snapshot.forEach((doc) => {
            list.push({ id: doc.id, ...doc.data() } as Subscription);
          });
          setCancelledSubs(list);
          setLoadingCancelled(false);
        })
        .catch((err) => {
          console.error("Error loading cancelled subs on-demand:", err);
          setLoadingCancelled(false);
        });
    } else {
      setCancelledSubs([]);
    }
  }, [showCancelled]);

  // Sync selection when navigated from another tab (B1/B2)
  useEffect(() => {
    if (preSelectedSubId) {
      const match = subscriptions.find((s) => s.id === preSelectedSubId);
      if (match) {
        setSelectedSub(match);
        setActiveTab("list");
        if (onClearPreSelectedSubId) {
          onClearPreSelectedSubId();
        }
      }
    }
  }, [preSelectedSubId, subscriptions]);

  // Sync editable notes when selectedSub changes (B2)
  useEffect(() => {
    if (selectedSub) {
      setSubNotes(selectedSub.notes || "");
    } else {
      setSubNotes("");
    }
  }, [selectedSub]);

  // Save updated notes to DB (B2)
  const handleSaveSubNotes = async () => {
    if (!selectedSub) return;
    setSavingNotes(true);
    try {
      const subRef = doc(db, "subscriptions", selectedSub.id!);
      await setDoc(subRef, sanitizeForFirestore({ notes: subNotes }), { merge: true });
      
      // Update local state copy to avoid lagging feel
      setSelectedSub(prev => prev ? { ...prev, notes: subNotes } : null);
      
      onRefresh();
    } catch (err) {
      console.error(err);
      setErrorMessage("Errore nel salvataggio delle note dell'abbonato.");
    } finally {
      setSavingNotes(false);
    }
  };

  // Helper to get all dates between two dates matching days of week
  const getDatesInRange = (startStr: string, endStr: string, days?: number[]): string[] => {
    const dates: string[] = [];
    const start = new Date(startStr);
    const end = new Date(endStr);
    const current = new Date(start);

    while (current <= end) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, "0");
      const d = String(current.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;

      if (!days || days.length === 0 || days.includes(current.getDay())) {
        dates.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    setConflictsList([]);

    // Validate inputs
    if (!customerName.trim()) {
      setErrorMessage("Il nome del cliente è obbligatorio.");
      setSaving(false);
      return;
    }

    const bedNums = bedNumbersInput
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n) && isValidBedNumber(n));

    if (bedNums.length === 0) {
      setErrorMessage("Inserisci almeno un numero di lettino valido dello stabilimento (es. 1-34, 60-109).");
      setSaving(false);
      return;
    }

    try {
      // 1. Generate dates list
      const dates = getDatesInRange(startDate, endDate, selectedDays);
      if (dates.length === 0) {
        throw new Error("Nessun giorno corrisponde ai criteri selezionati nell'intervallo date.");
      }

      // 2. Fetch all existing bookings on these beds and dates to check conflicts
      const conflicts: typeof conflictsList = [];
      const bookingsRef = collection(db, "bookings");
      
      // Query bookings overlapping in date
      const q = query(
        bookingsRef,
        where("bedNumber", "in", bedNums),
        where("date", ">=", startDate),
        where("date", "<=", endDate)
      );

      const snapshot = await getDocs(q).catch(err => {
        handleFirestoreError(err, OperationType.LIST, "bookings_conflict_check");
        throw err;
      });

      const existingInInterval = snapshot.docs.map(doc => doc.data() as Booking);

      // Check conflicts locally against generated dates and selected slot
      dates.forEach(date => {
        bedNums.forEach(bedNum => {
          const overlapping = existingInInterval.filter(b => b.date === date && b.bedNumber === bedNum);
          overlapping.forEach(b => {
            // Conflict if slots match or either slot is full_day
            if (b.slot === slot || b.slot === "full_day" || slot === "full_day") {
              conflicts.push({
                date,
                bedNumber: bedNum,
                slot: b.slot,
                customer: b.customerName
              });
            }
          });
        });
      });

      if (conflicts.length > 0) {
        setConflictsList(conflicts);
        throw new Error(`Conflitto di prenotazione rilevato! Risolvi le sovrapposizioni prima di procedere.`);
      }

      // 3. Setup Customer (A5)
      const custId = doc(collection(db, "customers")).id;
      const customerRef = doc(db, "customers", custId);
      const customerData = sanitizeForFirestore({
        name: customerName,
        phone: customerPhone,
        type: "subscriber",
        notes: customerNotes
      });
      await setDoc(customerRef, customerData);

      // 4. Save Subscription (A5)
      const subId = doc(collection(db, "subscriptions")).id;
      const subscriptionRef = doc(db, "subscriptions", subId);
      
      const subscriptionData: Subscription = sanitizeForFirestore({
        id: subId,
        customerId: custId,
        customerName: customerName,
        bedNumbers: bedNums,
        startDate,
        endDate,
        slot,
        priceTotal,
        status: "active",
        notes: customerNotes,
        ...(selectedDays.length > 0 ? { daysOfWeek: selectedDays } : {})
      });

      await setDoc(subscriptionRef, subscriptionData);

      // 5. Generate Bookings with Transactional anti double-booking logic (P1)
      const createdBookingIds: string[] = [];
      let bookingFailed = false;
      let failureReason = "";

      for (const date of dates) {
        if (bookingFailed) break;
        for (const bedNum of bedNums) {
          const bookingData = sanitizeForFirestore({
            bedNumber: bedNum,
            date,
            slot,
            customerId: custId,
            customerName,
            customerType: "subscriber" as const,
            subscriptionId: subId,
            source: "subscription" as const,
            notes: `Abbonamento: ${customerNotes}`
          });

          const txResult = await createBookingTransactional(bookingData);

          if (txResult.success && txResult.booking) {
            createdBookingIds.push(txResult.booking.id);
          } else {
            bookingFailed = true;
            failureReason = txResult.error || `Conflitto imprevisto sul lettino ${bedNum} in data ${date}`;
            break;
          }
        }
      }

      // Rollback if any single booking fails (keeping DB clean & consistent)
      if (bookingFailed) {
        for (const idToDel of createdBookingIds) {
          try {
            await deleteDoc(doc(db, "bookings", idToDel));
          } catch (e) {
            console.error("Rollback of booking failed:", idToDel, e);
          }
        }
        try {
          await deleteDoc(subscriptionRef);
        } catch (e) {
          console.error("Rollback of subscription failed:", subId, e);
        }
        try {
          await deleteDoc(customerRef);
        } catch (e) {
          console.error("Rollback of customer failed:", custId, e);
        }

        throw new Error(`Salvataggio interrotto per conflitto insorto durante la generazione: ${failureReason}`);
      }

      // Reset form
      setCustomerName("");
      setCustomerPhone("");
      setCustomerNotes("");
      setBedNumbersInput("");
      setSelectedDays([]);
      setActiveTab("list");
      onRefresh();

    } catch (err: any) {
      console.error(err);
      if (conflictsList.length === 0) {
        setErrorMessage(err.message || "Errore durante il salvataggio dell'abbonamento.");
      }
    } finally {
      setSaving(false);
    }
  };

  // Cancel/Delete subscription trigger
  const triggerCancelSubscription = (sub: Subscription) => {
    setSubToDelete(sub);
    setConfirmDeleteSubOpen(true);
  };

  const handleCancelSubscriptionConfirm = async () => {
    if (!subToDelete) return;
    setConfirmDeleteSubOpen(false);
    setSaving(true);
    setErrorMessage(null);
    try {
      const today = getRomeTodayString();

      // 1. Mark subscription as cancelled
      const subRef = doc(db, "subscriptions", subToDelete.id!);
      await setDoc(subRef, sanitizeForFirestore({ ...subToDelete, status: "cancelled" }));

      // 2. Query and delete future bookings belonging to this subscription
      const bookingsRef = collection(db, "bookings");
      const q = query(
        bookingsRef,
        where("subscriptionId", "==", subToDelete.id),
        where("date", ">", today)
      );

      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      setSelectedSub(null);
      onRefresh();
      setSubToDelete(null);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Errore durante la cancellazione dell'abbonamento.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddSubPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSub || payAmount <= 0) return;

    setSaving(true);
    try {
      const paymentId = `pay_${Date.now()}`;
      const paymentRef = doc(db, "payments", paymentId);

      await setDoc(paymentRef, sanitizeForFirestore({
        customerId: selectedSub.customerId,
        subscriptionId: selectedSub.id,
        amount: payAmount,
        method: payMethod,
        kind: payKind,
        date: serverTimestamp(),
        operator: "Staff"
      }));

      setPayAmount(0);
      onRefresh();
      // update panel info
      setTimeout(() => {
        onRefresh();
      }, 500);
    } catch (err) {
      console.error(err);
      setErrorMessage("Errore nella registrazione del pagamento.");
    } finally {
      setSaving(false);
    }
  };

  // Helper to calculate total payments and remaining balance (A3, B2)
  const getSubFinanceDetails = (subId: string, priceTotal: number) => {
    const isSelected = selectedSub?.id === subId;
    const subPayments = isSelected 
      ? selectedSubPayments 
      : payments.filter((p) => p.subscriptionId === subId);

    const paidSum = subPayments.reduce((sum, p) => sum + p.amount, 0);
    const balance = priceTotal - paidSum;
    
    let payStatus: "paid" | "partial" | "unpaid" = "unpaid";
    if (paidSum >= priceTotal) payStatus = "paid";
    else if (paidSum > 0) payStatus = "partial";

    return { paidSum, balance, payStatus, subPayments };
  };

  // Helper to calculate remaining days of a subscription
  const getSubRemainingDays = (endDateStr: string): number => {
    const today = new Date(getRomeTodayString());
    const end = new Date(endDateStr);
    const diffTime = end.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays < 0 ? 0 : diffDays;
  };

  const toggleDaySelection = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  return (
    <div id="sub-module-root" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* LEFT COLUMN: LIST or CREATE FORM */}
      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col h-full min-h-[600px]">
        
        {/* Tabs Headers */}
        <div className="flex justify-between items-center border-b border-slate-100 mb-6 flex-wrap gap-2">
          <div className="flex">
            <button
              id="tab-sub-list"
              onClick={() => { setActiveTab("list"); setErrorMessage(null); }}
              className={`pb-3 text-sm font-semibold px-4 transition-all border-b-2 ${
                activeTab === "list" 
                  ? "border-blue-600 text-blue-600" 
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Lista Abbonati ({subscriptions.length})
            </button>
            <button
              id="tab-sub-new"
              onClick={() => { setActiveTab("new"); setErrorMessage(null); }}
              className={`pb-3 text-sm font-semibold px-4 transition-all border-b-2 ${
                activeTab === "new" 
                  ? "border-blue-600 text-blue-600" 
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Nuovo Abbonamento
            </button>
          </div>

          {activeTab === "list" && (
            <button
              id="btn-toggle-show-cancelled"
              onClick={() => setShowCancelled(!showCancelled)}
              className={`pb-2 mb-1 text-xs font-bold px-3 py-1 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                showCancelled
                  ? "bg-slate-100 text-slate-800 border-slate-300"
                  : "bg-white text-slate-500 border-slate-200 hover:text-slate-800"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {showCancelled ? "Nascondi Disdetti" : "Mostra Disdetti / Storico"}
              {loadingCancelled && "..."}
            </button>
          )}
        </div>

        {errorMessage && (
          <div id="sub-error" className="flex items-start gap-2 p-4 bg-rose-50 border border-rose-100 rounded-xl mb-4 text-sm text-rose-700">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>{errorMessage}</div>
          </div>
        )}

        {/* Tab 1: LIST (Grid of compact cards) (B2) */}
        {activeTab === "list" && (
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const displayedSubs = showCancelled 
                ? [...subscriptions, ...cancelledSubs] 
                : subscriptions;

              if (displayedSubs.length === 0) {
                return (
                  <div className="text-center py-16 text-slate-400">
                    <UserPlus className="w-12 h-12 mx-auto stroke-1 mb-2 text-slate-300" />
                    <p className="font-semibold text-sm">Nessun abbonamento trovato</p>
                    <p className="text-xs">Usa il pannello a destra per registrarne uno.</p>
                  </div>
                );
              }

              return (
                <div id="sub-grid-container" className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                  {displayedSubs.map((sub) => {
                  const { paidSum, balance, payStatus } = getSubFinanceDetails(sub.id!, sub.priceTotal);
                  const remDays = getSubRemainingDays(sub.endDate);
                  const isSelected = selectedSub?.id === sub.id;

                  return (
                    <div
                      key={sub.id}
                      id={`sub-card-${sub.id}`}
                      onClick={() => setSelectedSub(sub)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-sm ${
                        isSelected
                          ? "bg-blue-50/50 border-blue-400 ring-1 ring-blue-400"
                          : "bg-white border-slate-100 hover:border-slate-300 hover:shadow-md"
                      }`}
                    >
                      {/* Title & Bed numbers */}
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm">{sub.customerName}</h4>
                          <span className="text-[10px] text-slate-400 font-semibold block mt-1">
                            {sub.startDate} al {sub.endDate}
                          </span>
                        </div>
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-mono font-black text-xs">
                          {sub.bedNumbers.join(", ")}
                        </span>
                      </div>

                      {/* Period and days remaining */}
                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span className="capitalize font-semibold text-slate-400">
                          {sub.slot === "full_day" ? "Giornata" : sub.slot === "morning" ? "Mattina" : "Pomeriggio"}
                        </span>
                        <span className={`font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded-md flex items-center gap-1 ${
                          remDays === 0 ? "text-rose-600 bg-rose-50" : ""
                        }`}>
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {remDays} gg residui
                        </span>
                      </div>

                      {/* Payment Status badge & residual */}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1">
                        <div>
                          {payStatus === "paid" ? (
                            <span className="text-[9px] font-black tracking-wider uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                              Saldato
                            </span>
                          ) : payStatus === "partial" ? (
                            <span className="text-[9px] font-black tracking-wider uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                              Acconto
                            </span>
                          ) : (
                            <span className="text-[9px] font-black tracking-wider uppercase bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">
                              Non Pagato
                            </span>
                          )}
                          {sub.status === "cancelled" && (
                            <span className="text-[9px] font-black tracking-wider uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full ml-1">
                              Disdetto
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-black text-slate-700">
                          {balance > 0 ? `Residuo: ${balance}€` : "Saldato"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          </div>
        )}

        {/* Tab 2: CREATE FORM */}
        {activeTab === "new" && (
          <form id="form-sub-create" onSubmit={handleCreateSubscription} className="space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Customer Info */}
              <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dati Cliente</h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nome Cognome Cliente</label>
                  <input
                    id="sub-cust-name"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Mario Rossi"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Telefono</label>
                  <input
                    id="sub-cust-phone"
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+39 333 1234567"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Note / Richieste</label>
                  <textarea
                    id="sub-cust-notes"
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    placeholder="Note o dettagli utili"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm h-20 resize-none"
                  />
                </div>
              </div>

              {/* Beds and Period */}
              <div className="space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assegnazione Lido</h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Numeri Lettini (separati da virgola)</label>
                  <input
                    id="sub-bed-numbers"
                    type="text"
                    required
                    value={bedNumbersInput}
                    onChange={(e) => setBedNumbersInput(e.target.value)}
                    placeholder="12, 13"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Inizio</label>
                    <input
                      id="sub-start-date"
                      type="date"
                      required
                      min="2026-01-01"
                      max="2026-12-31"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Fine</label>
                    <input
                      id="sub-end-date"
                      type="date"
                      required
                      min="2026-01-01"
                      max="2026-12-31"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Fascia Oraria (Slot)</label>
                  <select
                    id="sub-slot-select"
                    value={slot}
                    onChange={(e) => setSlot(e.target.value as BookingSlot)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                  >
                    <option value="full_day">Giornata Intera</option>
                    <option value="morning">Solo Mattina (AM)</option>
                    <option value="afternoon">Solo Pomeriggio (PM)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Price and Specific days selection */}
            <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Prezzo Totale (€)</label>
                  <input
                    id="sub-price-total"
                    type="number"
                    required
                    value={priceTotal}
                    onChange={(e) => setPriceTotal(Number(e.target.value))}
                    className="w-32 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Frequenza Settimana (Opzionale: es. solo weekend)</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { l: "Lun", v: 1 },
                      { l: "Mar", v: 2 },
                      { l: "Mer", v: 3 },
                      { l: "Gio", v: 4 },
                      { l: "Ven", v: 5 },
                      { l: "Sab", v: 6 },
                      { l: "Dom", v: 0 }
                    ].map((d) => {
                      const isSelected = selectedDays.includes(d.v);
                      return (
                        <button
                          key={d.v}
                          type="button"
                          id={`btn-day-${d.v}`}
                          onClick={() => toggleDaySelection(d.v)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${
                            isSelected 
                              ? "bg-blue-600 text-white" 
                              : "bg-white border border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Se non selezioni nulla, l'abbonamento si intende per tutti i giorni della settimana.
                  </span>
                </div>
              </div>
            </div>

            {/* Block with specific conflict diagnostics */}
            {conflictsList.length > 0 && (
              <div id="diagnostics-conflicts" className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-xs space-y-1 text-amber-800">
                <h5 className="font-bold flex items-center gap-1 mb-1">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Impossibile procedere! Trovati conflitti per i seguenti lettini:
                </h5>
                <ul className="list-disc pl-4 space-y-1 max-h-32 overflow-y-auto">
                  {conflictsList.map((c, i) => (
                    <li key={i}>
                      Il <strong>{c.date}</strong> - Lettino <strong>{c.bedNumber}</strong> (Fascia: {c.slot}) è già occupato da {c.customer}.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button
                id="btn-sub-new-cancel"
                type="button"
                onClick={() => { setActiveTab("list"); setErrorMessage(null); }}
                className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-semibold hover:bg-slate-50 rounded-xl transition-colors"
              >
                Annulla
              </button>
              <button
                id="btn-sub-new-submit"
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center gap-1"
              >
                {saving ? "Generazione in corso..." : "Genera Abbonamento & Prenotazioni"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* RIGHT COLUMN: DETAIL PANEL & QUICK PAYMENT */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col justify-between">
        {selectedSub ? (
          <div id="sub-detail-panel" className="space-y-6 flex-1 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dettaglio Abbonamento</span>
                  <h3 className="text-lg font-bold text-slate-800 mt-1">{selectedSub.customerName}</h3>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase ${
                  selectedSub.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                }`}>
                  {selectedSub.status === "active" ? "Attivo" : "Annullato"}
                </span>
              </div>

              {/* Sub Metadata info */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl text-xs text-slate-600">
                <div>
                  <span className="font-semibold text-slate-400 block mb-1">Lettini Assegnati</span>
                  <span className="font-bold text-slate-800 text-sm font-mono">{selectedSub.bedNumbers.join(", ")}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-400 block mb-1">Fascia Oraria</span>
                  <span className="font-bold text-slate-800 capitalize">{selectedSub.slot === "full_day" ? "Giornata Intera" : selectedSub.slot === "morning" ? "Mattina" : "Pomeriggio"}</span>
                </div>
                <div className="col-span-2 border-t border-slate-200 pt-2 mt-1">
                  <span className="font-semibold text-slate-400 block mb-1">Intervallo Date</span>
                  <span className="font-medium text-slate-800 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    dal {selectedSub.startDate} al {selectedSub.endDate}
                  </span>
                </div>
              </div>

              {/* Note dell'abbonato modificabili (B2) */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-xl text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider block">Note dell'Abbonato</span>
                <div className="flex gap-2">
                  <textarea
                    id="sub-notes-edit-textarea"
                    rows={2}
                    placeholder="Note particolari dell'abbonato..."
                    value={subNotes}
                    onChange={(e) => setSubNotes(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold resize-none text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    id="btn-sub-notes-save"
                    onClick={handleSaveSubNotes}
                    disabled={savingNotes || subNotes === (selectedSub.notes || "")}
                    className="px-3 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg border border-blue-100 font-bold transition-all disabled:opacity-50 flex items-center justify-center cursor-pointer"
                    title="Salva Note Abbonato"
                  >
                    {savingNotes ? "..." : <Save className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Finances */}
              {(() => {
                const { paidSum, balance, subPayments } = getSubFinanceDetails(selectedSub.id!, selectedSub.priceTotal);
                return (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stato Economico</h4>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-slate-50 p-2.5 rounded-lg">
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Prezzo</span>
                        <span className="text-base font-bold text-slate-800">{selectedSub.priceTotal}€</span>
                      </div>
                      <div className="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100">
                        <span className="text-[10px] text-emerald-600 block font-semibold uppercase">Pagato</span>
                        <span className="text-base font-bold text-emerald-800">{paidSum}€</span>
                      </div>
                      <div className={`p-2.5 rounded-lg border ${
                        balance > 0 ? "bg-rose-50 border-rose-100 text-rose-800" : "bg-slate-50 border-slate-100 text-slate-800"
                      }`}>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Residuo</span>
                        <span className="text-base font-bold">{balance}€</span>
                      </div>
                    </div>

                    {/* Pay Form */}
                    {balance > 0 && selectedSub.status === "active" && (
                      <form id="form-sub-payment" onSubmit={handleAddSubPayment} className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 space-y-2.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Registra Pagamento / Acconto</span>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              id="pay-amount-input"
                              type="number"
                              required
                              placeholder="Importo (€)"
                              value={payAmount || ""}
                              onChange={(e) => setPayAmount(Number(e.target.value))}
                              max={balance}
                              className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                            />
                            <span className="absolute left-2.5 top-1.5 text-xs text-slate-400">€</span>
                          </div>
                          <select
                            id="pay-method-select"
                            value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                            className="px-1.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                          >
                            <option value="cash">Contanti</option>
                            <option value="card">Carta/POS</option>
                          </select>
                        </div>
                        <button
                          id="btn-sub-pay-submit"
                          type="submit"
                          disabled={saving}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                        >
                          Registra {payAmount > 0 ? `${payAmount}€` : "Pagamento"}
                        </button>
                      </form>
                    )}

                    {/* History */}
                    {subPayments.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cronologia Acconti</span>
                        <div className="max-h-24 overflow-y-auto divide-y divide-slate-100 bg-slate-50 px-2 rounded-lg text-[10px] text-slate-600">
                          {subPayments.map((p, idx) => (
                            <div key={idx} className="py-1.5 flex justify-between items-center">
                              <span>Acconto / Saldo ({p.method === "cash" ? "Contanti" : "Carta"})</span>
                              <span className="font-bold text-slate-800">{p.amount}€</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Actions */}
            {selectedSub.status === "active" && (
              <button
                id="btn-sub-cancel"
                onClick={() => triggerCancelSubscription(selectedSub)}
                className="w-full py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors mt-4 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Disdici / Cancella Abbonamento
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-24 text-slate-400 flex-1 flex flex-col justify-center">
            <AlertCircle className="w-10 h-10 mx-auto stroke-1 text-slate-300 mb-2" />
            <p className="font-bold text-sm text-slate-500">Nessun Abbonato selezionato</p>
            <p className="text-xs">Seleziona un abbonato dalla tabella di sinistra per vederne i dettagli, i pagamenti e il saldo.</p>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={confirmDeleteSubOpen}
        title="Annulla Abbonamento"
        message={subToDelete ? `Sicuro di voler cancellare l'abbonamento per ${subToDelete.customerName}? Tutte le prenotazioni FUTURE saranno rimosse.` : ""}
        confirmLabel="Annulla Abbonamento"
        cancelLabel="Indietro"
        isDestructive={true}
        onConfirm={handleCancelSubscriptionConfirm}
        onCancel={() => {
          setConfirmDeleteSubOpen(false);
          setSubToDelete(null);
        }}
      />

    </div>
  );
}
