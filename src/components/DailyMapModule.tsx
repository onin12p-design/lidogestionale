import React, { useState } from "react";
import { Booking, Tab, Payment, BookingSlot, CustomerType, PaymentMethod, PaymentKind, BookingTipoPrenotazione } from "../types";
import { db, handleFirestoreError, OperationType, createBookingTransactional, getFirestore, setDoc, doc, collection, writeBatch, serverTimestamp, deleteDoc } from "../lib/firebase";
import { getRomeTodayString, adjustDateString, formatItalianDate, isValidBedNumber, sanitizeForFirestore, getPriceForBooking, getBookingPriceProportional, getBedLettiniCount, getBedItems, hasConflict } from "../utils";
import BedMap, { PEDANA_SINISTRA_LEFT, PEDANA_SINISTRA_RIGHT, PEDANA_DESTRA_LEFT, PEDANA_DESTRA_RIGHT } from "./BedMap";
import { Calendar, ChevronLeft, ChevronRight, Search, Plus, Trash2, CreditCard, Coffee, Check, AlertCircle, Info, Users, Save, Clock, Printer, X, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import ConfirmationModal from "./ConfirmationModal";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

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
  bedsConfig?: Record<number, number>;
  rowsConfig?: Record<number, number>;
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
  pricingConfigs = [],
  bedsConfig = {},
  rowsConfig = {}
}: DailyMapModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printType, setPrintType] = useState<"list" | "map" | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGenerateDailyPDF = () => {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const getFormattedNow = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };

    const drawHeader = (pageNumber: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(2, 90, 112); // Samarinda #025A70
      doc.text("LIDO SAMARINDA FINE BEACH", 14, 15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text("REGISTRO GIORNALIERO CLIENTI", 14, 21);

      const periodStr = `Giorno di Riferimento: ${formatItalianDate(currentDate)}`;
      doc.text(periodStr, 14, 27);

      const genTimeStr = `Generato il: ${getFormattedNow()}`;
      doc.text(genTimeStr, 135, 27);

      doc.setDrawColor(226, 232, 240);
      doc.line(14, 31, 196, 31);
    };

    const leftBookings = bookings.filter(b => b.bedNumber <= 34).sort((a, b) => a.bedNumber - b.bedNumber);
    const rightBookings = bookings.filter(b => b.bedNumber > 34).sort((a, b) => a.bedNumber - b.bedNumber);
    const sortedBookings = [...leftBookings, ...rightBookings];

    const paymentsByBookingId = new Map<string, Payment[]>();
    payments.forEach(p => {
      if (p.bookingId) {
        if (!paymentsByBookingId.has(p.bookingId)) {
          paymentsByBookingId.set(p.bookingId, []);
        }
        paymentsByBookingId.get(p.bookingId)!.push(p);
      }
    });

    const tableBody = sortedBookings.map((b) => {
      const isSubscriber = b.customerType === "subscriber";
      const isHotel = b.isHotel;
      const tipoLabel = isSubscriber ? "Abbonamento" : isHotel ? "Hotel" : "Giornaliero";
      const side = b.bedNumber <= 34 ? "SX" : "DX";

      const bPayments = paymentsByBookingId.get(b.id) || [];
      let amountText = "–";
      let methodText = "Da pagare";
      if (bPayments.length > 0) {
        const totalAmount = bPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        amountText = `${totalAmount} €`;
        const methodsSet = new Set(bPayments.map(p => {
          if (p.method === "card") return "Carta";
          if (p.method === "cash") return "Contanti";
          return p.method || "";
        }).filter(Boolean));
        methodText = Array.from(methodsSet).join(" + ") || "Da pagare";
      }

      return [
        `${b.bedNumber} ${side}`,
        b.customerName,
        tipoLabel,
        b.notes || "-",
        amountText,
        methodText
      ];
    });

    let totalIncassato = 0;
    let totalContanti = 0;
    let totalCarta = 0;
    let countContanti = 0;
    let countCarta = 0;

    payments.forEach(p => {
      const amt = p.amount || 0;
      totalIncassato += amt;
      if (p.method === "cash") {
        totalContanti += amt;
        countContanti++;
      } else if (p.method === "card") {
        totalCarta += amt;
        countCarta++;
      }
    });

    autoTable(doc, {
      startY: 38,
      head: [["Postazione", "Cliente/Nome", "Tipo", "Note", "Importo (€)", "Metodo"]],
      body: tableBody,
      theme: "striped",
      headStyles: { fillColor: [2, 90, 112] },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 25, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 50 },
        2: { cellWidth: 30 },
        3: { cellWidth: 37 },
        4: { cellWidth: 22, halign: "right" },
        5: { cellWidth: 20, halign: "center" }
      },
      margin: { top: 38, left: 14, right: 14, bottom: 45 },
      didDrawPage: (data) => {
        drawHeader(data.pageNumber);
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 38;
    const pageHeight = doc.internal.pageSize.height;
    
    let summaryY = finalY + 10;
    if (summaryY + 30 > pageHeight) {
      doc.addPage();
      drawHeader(1);
      summaryY = 38;
    }

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, summaryY, 182, 26, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("RIEPILOGO GIORNALIERO", 18, summaryY + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Totale Clienti Presenti: ${bookings.length}`, 18, summaryY + 12);
    doc.text(`Totale Incassato:`, 18, summaryY + 18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(2, 90, 112);
    doc.text(`${totalIncassato} €`, 47, summaryY + 18);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`di cui Contanti:`, 85, summaryY + 18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`${totalContanti} € (${countContanti} pagamenti)`, 110, summaryY + 18);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`di cui Carta:`, 85, summaryY + 23);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`${totalCarta} € (${countCarta} pagamenti)`, 110, summaryY + 23);

    doc.save(`registro_giornaliero_${currentDate}.pdf`);
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null);

  // Quick booking form state
  const [custName, setCustName] = useState("");
  const [custType, setCustType] = useState<CustomerType>("daily");
  const [isHotel, setIsHotel] = useState<boolean>(false);
  const [bookSlot, setBookSlot] = useState<BookingSlot>("full_day");
  const [tipoPrenotazione, setTipoPrenotazione] = useState<BookingTipoPrenotazione>("intera");
  const [selectedRisorse, setSelectedRisorse] = useState<string[]>([]);
  const [cartRisorse, setCartRisorse] = useState<{ postazione: number, items: string[] }[]>([]);
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

  // Check which slots are still free for the selected bed (at least one item is free for that slot)
  const getFreeSlotsForSelectedBed = () => {
    if (selectedBed === null) return [];
    const numLettini = getBedLettiniCount(selectedBed, bedsConfig);
    const allItems = getBedItems(selectedBed, numLettini);

    const free: BookingSlot[] = [];
    const slotsToTest: BookingSlot[] = ["morning", "afternoon", "full_day"];

    slotsToTest.forEach((slot) => {
      // Is there at least one item on this bed that does not have a conflict with this slot?
      const anyItemFree = allItems.some((item) => {
        const itemBookings: any[] = [];
        selectedBedBookings.forEach((b) => {
          let occupiedItems: string[] = [];
          if (b.risorse && b.risorse.length > 0) {
            const res = b.risorse.find((r) => r.postazione === selectedBed);
            if (res) occupiedItems = res.items;
          } else {
            const numL = getBedLettiniCount(selectedBed, bedsConfig);
            occupiedItems = getBedItems(selectedBed, numL);
          }
          if (occupiedItems.includes(item)) {
            itemBookings.push(b);
          }
        });

        return !hasConflict(itemBookings, slot, item, [item]);
      });

      if (anyItemFree) {
        free.push(slot);
      }
    });

    return free;
  };

  const freeSlots = getFreeSlotsForSelectedBed();

  // Helper to calculate which resources are already occupied for a slot
  const getOccupiedResourcesForSlot = (slot: BookingSlot) => {
    const occupied = new Set<string>();
    if (selectedBed === null) return occupied;

    selectedBedBookings.forEach((b) => {
      // Overlap checks: AM overlaps with Full Day or AM; PM overlaps with Full Day or PM; Full Day overlaps with any
      const overlap = 
        slot === "full_day" || 
        b.slot === "full_day" || 
        b.slot === slot;
      
      if (overlap) {
        let items: string[] = [];
        if (b.risorse && b.risorse.length > 0) {
          const res = b.risorse.find((r) => r.postazione === selectedBed);
          if (res) items = res.items;
        } else {
          // Default legacy occupies all items of the bed
          const numLettini = getBedLettiniCount(selectedBed, bedsConfig);
          items = getBedItems(selectedBed, numLettini);
        }
        items.forEach(item => occupied.add(item));
      }
    });
    return occupied;
  };

  // Synchronize slot, default tipoPrenotazione, and selected/available sub-resources
  React.useEffect(() => {
    if (selectedBed !== null) {
      // 1. Resolve slot
      let activeSlot = bookSlot;
      if (!freeSlots.includes(bookSlot) && freeSlots.length > 0) {
        activeSlot = freeSlots[0];
        setBookSlot(freeSlots[0]);
      }

      // 2. Resolve default tipoPrenotazione matching the slot
      let defaultTipo: BookingTipoPrenotazione = "intera";
      if (activeSlot === "morning") defaultTipo = "mattina";
      else if (activeSlot === "afternoon") defaultTipo = "pomeriggio";
      setTipoPrenotazione(defaultTipo);

      // 3. Resolve available and default selected sub-resources
      const numLettini = getBedLettiniCount(selectedBed, bedsConfig);
      const allItems = getBedItems(selectedBed, numLettini);
      const occupied = getOccupiedResourcesForSlot(activeSlot);
      const available = allItems.filter(item => !occupied.has(item));
      setSelectedRisorse(available);
    } else {
      setSelectedRisorse([]);
    }

    // Synchronize interactive notes
    const notesMap: Record<string, string> = {};
    selectedBedBookings.forEach((b) => {
      notesMap[b.id] = b.notes || "";
    });
    setActiveNotes(notesMap);
  }, [selectedBed, bookings]);

  // Adjust default tipoPrenotazione and selected resources when bookSlot itself changes
  React.useEffect(() => {
    if (selectedBed !== null) {
      let defaultTipo: BookingTipoPrenotazione = "intera";
      if (bookSlot === "morning") defaultTipo = "mattina";
      else if (bookSlot === "afternoon") defaultTipo = "pomeriggio";
      setTipoPrenotazione(defaultTipo);

      const numLettini = getBedLettiniCount(selectedBed, bedsConfig);
      const allItems = getBedItems(selectedBed, numLettini);
      const occupied = getOccupiedResourcesForSlot(bookSlot);
      const available = allItems.filter(item => !occupied.has(item));
      setSelectedRisorse(available);
    }
  }, [bookSlot]);

  // Calculate final proportional price of the form
  React.useEffect(() => {
    if (cartRisorse.length > 0) {
      const mockBooking = {
        date: currentDate,
        slot: bookSlot,
        risorse: cartRisorse
      };
      const totalPrice = getBookingPriceProportional(mockBooking, pricingConfigs, bedsConfig, rowsConfig);
      setBookPrice(totalPrice);
    } else if (selectedBed !== null) {
      const mockBooking = {
        date: currentDate,
        slot: bookSlot,
        risorse: [{ postazione: selectedBed, items: selectedRisorse }]
      };
      const totalPrice = getBookingPriceProportional(mockBooking, pricingConfigs, bedsConfig, rowsConfig);
      setBookPrice(totalPrice);
    }
  }, [selectedBed, bookSlot, selectedRisorse, cartRisorse, currentDate, pricingConfigs, bedsConfig, rowsConfig]);

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
    if (!custName.trim()) return;

    const finalRisorse = cartRisorse.length > 0
      ? cartRisorse
      : selectedBed !== null ? [{ postazione: selectedBed, items: selectedRisorse }] : [];

    if (finalRisorse.length === 0 || finalRisorse.every(r => r.items.length === 0)) {
      setErrorMessage("Errore: devi selezionare almeno una risorsa (es. l'ombrellone o un lettino).");
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      // Use the transactional helper for double-booking protection (A1)
      const primaryBed = finalRisorse[0].postazione;
      const result = await createBookingTransactional({
        bedNumber: primaryBed,
        date: currentDate,
        slot: bookSlot,
        tipoPrenotazione,
        risorse: finalRisorse,
        customerId: "", // No customer record generated for daily bookings (FIX 1)
        customerName: custName,
        customerType: "daily",
        source: "manual",
        notes: bookNotes,
        isHotel: isHotel,
        hotelPaymentStatus: isHotel ? "Hotel (non da saldare)" : ""
      });

      if (!result.success) {
        setErrorMessage(result.error || "Conflitto rilevato. Impossibile creare la prenotazione.");
        return;
      }

      // Reset form
      setCustName("");
      setBookNotes("");
      setCartRisorse([]);
      setIsHotel(false);
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
        operator: "Staff",
        dateStr: currentDate
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

    const expectedPrice = booking.isHotel
      ? (paidSum > 0 ? paidSum : 0)
      : getBookingPriceProportional(booking, pricingConfigs, bedsConfig);
    const balance = booking.isHotel ? 0 : (expectedPrice - paidSum);

    let payStatus: "paid" | "partial" | "unpaid" | "hotel" = "unpaid";
    if (booking.isHotel) {
      payStatus = "hotel";
    } else if (paidSum >= expectedPrice || (isSub && subPaid > 0)) {
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
              id="btn-print-list-clienti"
              onClick={() => {
                setPrintType("list");
                setIsPrintModalOpen(true);
              }}
              className="px-3 py-2 bg-[#025A70]/10 hover:bg-[#025A70]/20 text-[#025A70] font-black text-[11.5px] rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0 border border-[#025A70]/10 h-9"
              title="Stampa lista clienti presenti/assegnati"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Stampa lista clienti</span>
            </button>

            <button
              id="btn-print-mappa-spiaggia"
              onClick={() => {
                setPrintType("map");
                setIsPrintModalOpen(true);
              }}
              className="px-3 py-2 bg-[#025A70]/10 hover:bg-[#025A70]/20 text-[#025A70] font-black text-[11.5px] rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0 border border-[#025A70]/10 h-9"
              title="Stampa mappa/pianta delle postazioni"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Stampa mappa</span>
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
            bedsConfig={bedsConfig}
            rowsConfig={rowsConfig}
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
                            ) : payStatus === "hotel" ? (
                              <span className="text-sky-600 font-bold">Hotel (non da saldare)</span>
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
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
                      <select
                        id="book-is-hotel"
                        value={isHotel ? "hotel" : "standard"}
                        onChange={(e) => setIsHotel(e.target.value === "hotel")}
                        className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
                      >
                        <option value="standard">Cliente</option>
                        <option value="hotel">Hotel</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Fascia Oraria</label>
                      <select
                        id="book-slot"
                        value={bookSlot}
                        onChange={(e) => setBookSlot(e.target.value as BookingSlot)}
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

                  {/* CR-1: Tipo Prenotazione Select */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo Prenotazione</label>
                    <select
                      id="book-tipo-prenotazione"
                      value={tipoPrenotazione}
                      onChange={(e) => setTipoPrenotazione(e.target.value as BookingTipoPrenotazione)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                    >
                      <option value="intera">Giornata Intera</option>
                      <option value="mattina">Mattina</option>
                      <option value="pomeriggio">Pomeriggio</option>
                      <option value="abbonato">Abbonato</option>
                    </select>
                  </div>

                  {/* CR-2: Risorse Selezionabili */}
                  <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-200/60 space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Risorse Postazione {selectedBed}</span>
                    {selectedBed !== null && (() => {
                      const numLettini = getBedLettiniCount(selectedBed, bedsConfig);
                      const allItems = getBedItems(selectedBed, numLettini);
                      const occupied = getOccupiedResourcesForSlot(bookSlot);

                      return (
                        <div className="space-y-1.5">
                          {allItems.map((item) => {
                            const isOccupiedByOther = occupied.has(item);
                            const isSelected = selectedRisorse.includes(item);
                            const label = item === "ombrellone" ? "Ombrellone" : `Lettino ${item.split("_")[1]}`;
                            
                            return (
                              <label key={item} className={`flex items-center gap-2 text-xs font-medium ${isOccupiedByOther ? "text-slate-400 line-through" : "text-slate-700 cursor-pointer"}`}>
                                <input
                                  type="checkbox"
                                  disabled={isOccupiedByOther}
                                  checked={isSelected && !isOccupiedByOther}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedRisorse([...selectedRisorse, item]);
                                    } else {
                                      setSelectedRisorse(selectedRisorse.filter(x => x !== item));
                                    }
                                  }}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                />
                                <span>
                                  {label} {isOccupiedByOther && <span className="text-[10px] text-rose-500 font-bold ml-1">(Occupato)</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {selectedBed !== null && selectedRisorse.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const existingIdx = cartRisorse.findIndex(cr => cr.postazione === selectedBed);
                          if (existingIdx > -1) {
                            const updated = [...cartRisorse];
                            updated[existingIdx] = { postazione: selectedBed, items: selectedRisorse };
                            setCartRisorse(updated);
                          } else {
                            setCartRisorse([...cartRisorse, { postazione: selectedBed, items: selectedRisorse }]);
                          }
                        }}
                        className="w-full mt-2 py-1.5 px-2 bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-extrabold uppercase rounded-lg tracking-wider transition-colors cursor-pointer text-center"
                      >
                        Aggiungi a Prenotazione Multi-Postazione
                      </button>
                    )}
                  </div>

                  {/* CR-2: Cart View */}
                  {cartRisorse.length > 0 && (
                    <div className="bg-slate-950 text-slate-100 p-3 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Carrello Multi-Postazione</span>
                        <button
                          type="button"
                          onClick={() => setCartRisorse([])}
                          className="text-rose-400 hover:text-rose-300 text-[10px] font-bold uppercase"
                        >
                          Svuota
                        </button>
                      </div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {cartRisorse.map((cr, idx) => (
                          <div key={idx} className="flex justify-between items-center text-[11px] bg-slate-900/50 p-2 rounded-lg border border-slate-800">
                            <div>
                              <strong className="text-[#F2A104]">Lettino {cr.postazione}:</strong>{" "}
                              <span className="text-slate-300">
                                {cr.items.map(it => it === "ombrellone" ? "Omb." : `Let. ${it.split("_")[1]}`).join(", ")}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCartRisorse(cartRisorse.filter((_, i) => i !== idx));
                              }}
                              className="text-slate-400 hover:text-rose-400 font-bold ml-2 text-sm"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Price calculations display */}
                  <div className="flex justify-between items-center bg-blue-50/40 px-3.5 py-2.5 rounded-xl border border-blue-100/30">
                    <span className="text-xs font-semibold text-blue-800">Prezzo Calcolato:</span>
                    <span className="text-sm font-black text-blue-900">
                      {bookPrice} €
                      <span className="text-[10px] font-normal text-blue-700 ml-1.5">
                        {cartRisorse.length > 0 ? (
                          `(${cartRisorse.reduce((acc, cr) => acc + cr.items.length, 0)} risorse multi-bed)`
                        ) : (
                          `(${selectedRisorse.length} di ${selectedBed !== null ? getBedLettiniCount(selectedBed, bedsConfig) + 1 : 3} risorse)`
                        )}
                      </span>
                    </span>
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
      {isPrintModalOpen && printType && (
        <div id="print-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex flex-col p-4 md:p-8 overflow-y-auto print:static print:block print:p-0 print:m-0 print:bg-white print:overflow-visible print:h-auto print:w-full">
          
          {/* Dynamic Style Injection for portrait vs landscape A4 print sizing */}
          {printType === "list" ? (
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                @page {
                  size: portrait;
                  margin: 15mm;
                }
                html, body, #root {
                  height: auto !important;
                  overflow: visible !important;
                  position: static !important;
                  background: white !important;
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
                /* Repeated table header and styling for Vertical A4 client list */
                thead {
                  display: table-header-group !important;
                }
                tr {
                  page-break-inside: avoid !important;
                }
                .even\\:bg-slate-50\\/80 {
                  background-color: #f8fafc !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                .bg-slate-100 {
                  background-color: #f1f5f9 !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
              }
            `}} />
          ) : (
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                @page {
                  size: landscape;
                  margin: 5mm;
                }
                html, body, #root {
                  height: auto !important;
                  overflow: visible !important;
                  position: static !important;
                  background: white !important;
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
                .print-map-container {
                  page-break-inside: avoid !important;
                  max-height: 98vh !important;
                  overflow: hidden !important;
                }
                /* Force background color display in B&W / Color print previews */
                .bg-slate-900 {
                  background-color: #0f172a !important;
                  color: white !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                .text-white {
                  color: #ffffff !important;
                }
              }
            `}} />
          )}

          {/* Action Header - Hidden during actual print */}
          <div className="bg-white rounded-t-2xl border-b border-slate-100 p-4 max-w-5xl w-full mx-auto flex items-center justify-between shadow-sm print:hidden shrink-0">
            <div className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-[#025A70]" />
              <div className="text-left">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                  {printType === "list" ? "Anteprima di Stampa: Lista Clienti" : "Anteprima di Stampa: Pianta Spiaggia"}
                </h3>
                <p className="text-[10px] text-slate-400 font-medium">
                  {printType === "list" 
                    ? "Ottimizzato per foglio A4 Verticale (Usa orientamento Portrait/Verticale)" 
                    : "Ottimizzato per foglio A4 Orizzontale (Usa orientamento Landscape/Orizzontale)"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                id="btn-trigger-browser-print"
                onClick={() => {
                  try {
                    if (printType === "list") {
                      handleGenerateDailyPDF();
                      setIsPrintModalOpen(false);
                      setPrintType(null);
                    } else {
                      window.focus();
                      window.print();
                    }
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
                onClick={() => {
                  setIsPrintModalOpen(false);
                  setPrintType(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Iframe sandbox warning banner - Hidden during actual print */}
          {typeof window !== "undefined" && window.self !== window.top && (
            <div className="bg-amber-50 border-x border-b border-amber-100 p-4 max-w-5xl w-full mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner print:hidden shrink-0">
              <div className="flex items-start gap-2.5 text-amber-800 text-xs font-semibold">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-left">
                  <p className="font-extrabold text-amber-900 uppercase tracking-wider text-[11px]">Avviso Anteprima Protetta</p>
                  <p className="leading-relaxed text-slate-600 font-medium text-[11px]">
                    I browser moderni bloccano l'apertura della finestra di stampa (<code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-900">window.print()</code>) quando l'applicazione è incorporata all'interno dell'anteprima di AI Studio.
                  </p>
                  <p className="leading-relaxed text-slate-600 font-bold text-[11px]">
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
          <div id="print-preview-document" className="bg-white p-6 md:p-10 max-w-5xl w-full mx-auto rounded-b-2xl shadow-lg text-black print:shadow-none print:p-0 print:m-0 overflow-y-auto">
            
            {/* STAMPA LISTA CLIENTI */}
            {printType === "list" && (
              <div id="print-list-content" className="space-y-6 text-black">
                {/* Header */}
                <div className="border-b-2 border-black pb-4 flex justify-between items-end">
                  <div className="text-left">
                    <h1 className="text-xl font-black tracking-wide uppercase text-slate-900">LIDO SAMARINDA FINE BEACH</h1>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                      Registro Giornaliero Clienti Assegnati alle Postazioni
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Giorno di Riferimento</span>
                    <span className="text-sm font-black text-black bg-slate-100/60 px-2 py-1 rounded border border-slate-200 uppercase print:bg-white print:border-none print:p-0">
                      {formatItalianDate(currentDate)}
                    </span>
                  </div>
                </div>

                {/* Tabella clienti ordinata per numero postazione crescente, prima SX poi DX */}
                <div className="mt-4">
                  <table className="w-full text-left text-[11pt] border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-slate-100 border-b-2 border-slate-400 text-slate-800 font-bold" style={{ display: "table-header-group" }}>
                        <th className="py-2.5 px-3 border border-slate-300 text-center w-28 text-[11pt]">Postazione</th>
                        <th className="py-2.5 px-3 border border-slate-300 text-[11pt]">Cliente/Nome</th>
                        <th className="py-2.5 px-3 border border-slate-300 w-44 text-[11pt]">Tipo</th>
                        <th className="py-2.5 px-3 border border-slate-300 text-[11pt]">Note</th>
                        <th className="py-2.5 px-3 border border-slate-300 text-right w-28 text-[11pt]">Importo (€)</th>
                        <th className="py-2.5 px-3 border border-slate-300 text-center w-36 text-[11pt]">Metodo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(() => {
                        const leftBookings = bookings.filter(b => b.bedNumber <= 34).sort((a, b) => a.bedNumber - b.bedNumber);
                        const rightBookings = bookings.filter(b => b.bedNumber > 34).sort((a, b) => a.bedNumber - b.bedNumber);
                        const sortedBookings = [...leftBookings, ...rightBookings];

                        if (sortedBookings.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                                Nessun cliente presente nelle postazioni per il giorno selezionato.
                              </td>
                            </tr>
                          );
                        }

                        return sortedBookings.map((b) => {
                          const isSubscriber = b.customerType === "subscriber";
                          const isHotel = b.isHotel;
                          const tipoLabel = isSubscriber ? "Abbonamento" : isHotel ? "Hotel" : "Giornaliero";
                          const side = b.bedNumber <= 34 ? "SX" : "DX";
                          
                          // Look up payments for this booking
                          const bPayments = payments.filter((p) => p.bookingId === b.id);
                          let amountText = "–";
                          let methodText = "Da pagare";
                          if (bPayments.length > 0) {
                            const totalAmount = bPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                            amountText = `${totalAmount} €`;
                            const methodsSet = new Set(bPayments.map(p => {
                              if (p.method === "card") return "Carta";
                              if (p.method === "cash") return "Contanti";
                              return p.method || "";
                            }).filter(Boolean));
                            methodText = Array.from(methodsSet).join(" + ") || "Da pagare";
                          }

                          return (
                            <tr key={b.id} className="even:bg-slate-50/80">
                              <td className="py-2.5 px-3 border border-slate-300 font-extrabold text-center text-slate-900 bg-slate-50/50">
                                {b.bedNumber} {side}
                              </td>
                              <td className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-slate-900">
                                {b.customerName}
                              </td>
                              <td className="py-2.5 px-3 border border-slate-300 font-medium text-slate-700">
                                {tipoLabel}
                              </td>
                              <td className="py-2.5 px-3 border border-slate-300 text-slate-600 text-[11pt]">
                                {b.notes || "-"}
                              </td>
                              <td className="py-2.5 px-3 border border-slate-300 font-bold text-right text-slate-950">
                                {amountText}
                              </td>
                              <td className="py-2.5 px-3 border border-slate-300 font-bold text-center text-slate-800">
                                {methodText}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Riepilogo Giornaliero */}
                {(() => {
                  let totalIncassato = 0;
                  let totalContanti = 0;
                  let totalCarta = 0;
                  let countContanti = 0;
                  let countCarta = 0;

                  payments.forEach(p => {
                    const amt = p.amount || 0;
                    totalIncassato += amt;
                    if (p.method === "cash") {
                      totalContanti += amt;
                      countContanti++;
                    } else if (p.method === "card") {
                      totalCarta += amt;
                      countCarta++;
                    }
                  });

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3 mt-6">
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">Riepilogo Giornaliero</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-bold text-slate-600 uppercase tracking-wider">
                        <div className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                          <span className="block text-slate-400 text-[10px]">Totale Incassato</span>
                          <span className="text-lg font-black text-[#025A70]">{totalIncassato} €</span>
                        </div>
                        <div className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                          <span className="block text-slate-400 text-[10px]">di cui Contanti</span>
                          <span className="text-lg font-black text-slate-800">{totalContanti} € ({countContanti} pagamenti)</span>
                        </div>
                        <div className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                          <span className="block text-slate-400 text-[10px]">di cui Carta</span>
                          <span className="text-lg font-black text-slate-800">{totalCarta} € ({countCarta} pagamenti)</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Totale clienti in calce */}
                <div className="mt-8 pt-4 border-t border-slate-300 flex justify-between items-center text-xs text-slate-500 font-bold uppercase tracking-wider">
                  <span>Totale Clienti Presenti: {bookings.length}</span>
                  <span>Stampato il {new Date().toLocaleDateString("it-IT")}</span>
                </div>
              </div>
            )}

            {/* STAMPA MAPPA SPIAGGIA */}
            {printType === "map" && (
              <div id="print-map-content" className="space-y-4 text-black">
                {/* Header */}
                <div className="border-b border-slate-200 pb-2 flex justify-between items-end">
                  <div className="text-left">
                    <h1 className="text-lg font-black tracking-wide uppercase text-slate-900">LIDO SAMARINDA — PIANTA SPIAGGIA</h1>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                      Mappa grafica delle postazioni spiaggia per la gestione cartacea giornaliera
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[8px] font-bold text-slate-400 uppercase block">Giorno di Riferimento</span>
                    <span className="text-xs font-black text-black bg-slate-100/60 px-2 py-0.5 rounded border border-slate-200 uppercase print:bg-white print:border-none print:p-0">
                      {formatItalianDate(currentDate)}
                    </span>
                  </div>
                </div>

                {/* Map grid side-by-side to fit on a single landscape page */}
                <div className="grid grid-cols-2 gap-3 print-map-container">
                  {/* PEDANA SINISTRA */}
                  <div className="border border-slate-300 p-2.5 rounded-xl bg-white flex flex-col justify-between">
                    <h3 className="text-[10px] font-black uppercase text-center mb-2 tracking-wider border-b border-slate-200 pb-0.5 text-slate-800">
                      PEDANA SINISTRA
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Griglia Sinistra */}
                      <div className="space-y-1">
                        <span className="text-[8px] font-bold uppercase block text-center text-slate-400">Griglia Sinistra (1-34)</span>
                        <div className="grid grid-cols-5 gap-1">
                          {PEDANA_SINISTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => {
                            if (bedNum === null) return <div key={`print-ps-left-null-${idx}`} className="h-8 border border-transparent"></div>;
                            const bList = bookings.filter((b) => b.bedNumber === bedNum);
                            const surnameText = bList.map(b => {
                              const parts = b.customerName.trim().split(/\s+/);
                              return parts.length > 1 ? parts[parts.length - 1] : parts[0];
                            }).join("/");
                            const isOccupied = bList.length > 0;
                            return (
                              <div 
                                key={`print-ps-left-${bedNum}`} 
                                className={`p-0.5 text-center flex flex-col justify-center h-8 rounded ${
                                  isOccupied 
                                    ? "bg-slate-900 text-white border border-slate-900" 
                                    : "border border-slate-300 bg-white text-slate-800"
                                }`}
                              >
                                <span className={`text-[9px] font-black leading-none ${isOccupied ? "text-white" : "text-slate-800"}`}>
                                  {bedNum}
                                </span>
                                {isOccupied && (
                                  <span className="text-[6px] font-bold truncate uppercase leading-none mt-0.5 text-white block">
                                    {surnameText}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Griglia Destra */}
                      <div className="space-y-1">
                        <span className="text-[8px] font-bold uppercase block text-center text-slate-400">Griglia Destra (6-30)</span>
                        <div className="grid grid-cols-5 gap-1">
                          {PEDANA_SINISTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => {
                            if (bedNum === null) return <div key={`print-ps-right-null-${idx}`} className="h-8 border border-transparent"></div>;
                            const bList = bookings.filter((b) => b.bedNumber === bedNum);
                            const surnameText = bList.map(b => {
                              const parts = b.customerName.trim().split(/\s+/);
                              return parts.length > 1 ? parts[parts.length - 1] : parts[0];
                            }).join("/");
                            const isOccupied = bList.length > 0;
                            return (
                              <div 
                                key={`print-ps-right-${bedNum}`} 
                                className={`p-0.5 text-center flex flex-col justify-center h-8 rounded ${
                                  isOccupied 
                                    ? "bg-slate-900 text-white border border-slate-900" 
                                    : "border border-slate-300 bg-white text-slate-800"
                                }`}
                              >
                                <span className={`text-[9px] font-black leading-none ${isOccupied ? "text-white" : "text-slate-800"}`}>
                                  {bedNum}
                                </span>
                                {isOccupied && (
                                  <span className="text-[6px] font-bold truncate uppercase leading-none mt-0.5 text-white block">
                                    {surnameText}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* PEDANA DESTRA */}
                  <div className="border border-slate-300 p-2.5 rounded-xl bg-white flex flex-col justify-between">
                    <h3 className="text-[10px] font-black uppercase text-center mb-2 tracking-wider border-b border-slate-200 pb-0.5 text-slate-800">
                      PEDANA DESTRA
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Griglia Sinistra */}
                      <div className="space-y-1">
                        <span className="text-[8px] font-bold uppercase block text-center text-slate-400">Griglia Sinistra (60-97)</span>
                        <div className="grid grid-cols-5 gap-1">
                          {PEDANA_DESTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => {
                            if (bedNum === null) return <div key={`print-pd-left-null-${idx}`} className="h-8 border border-transparent"></div>;
                            const bList = bookings.filter((b) => b.bedNumber === bedNum);
                            const surnameText = bList.map(b => {
                              const parts = b.customerName.trim().split(/\s+/);
                              return parts.length > 1 ? parts[parts.length - 1] : parts[0];
                            }).join("/");
                            const isOccupied = bList.length > 0;
                            return (
                              <div 
                                key={`print-pd-left-${bedNum}`} 
                                className={`p-0.5 text-center flex flex-col justify-center h-8 rounded ${
                                  isOccupied 
                                    ? "bg-slate-900 text-white border border-slate-900" 
                                    : "border border-slate-300 bg-white text-slate-800"
                                }`}
                              >
                                <span className={`text-[9px] font-black leading-none ${isOccupied ? "text-white" : "text-slate-800"}`}>
                                  {bedNum}
                                </span>
                                {isOccupied && (
                                  <span className="text-[6px] font-bold truncate uppercase leading-none mt-0.5 text-white block">
                                    {surnameText}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Griglia Destra */}
                      <div className="space-y-1">
                        <span className="text-[8px] font-bold uppercase block text-center text-slate-400">Griglia Destra (65-109)</span>
                        <div className="grid grid-cols-6 gap-1">
                          {PEDANA_DESTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => {
                            if (bedNum === null) return <div key={`print-pd-right-null-${idx}`} className="h-8 border border-transparent"></div>;
                            const bList = bookings.filter((b) => b.bedNumber === bedNum);
                            const surnameText = bList.map(b => {
                              const parts = b.customerName.trim().split(/\s+/);
                              return parts.length > 1 ? parts[parts.length - 1] : parts[0];
                            }).join("/");
                            const isOccupied = bList.length > 0;
                            return (
                              <div 
                                key={`print-pd-right-${bedNum}`} 
                                className={`p-0.5 text-center flex flex-col justify-center h-8 rounded ${
                                  isOccupied 
                                    ? "bg-slate-900 text-white border border-slate-900" 
                                    : "border border-slate-300 bg-white text-slate-800"
                                }`}
                              >
                                <span className={`text-[9px] font-black leading-none ${isOccupied ? "text-white" : "text-slate-800"}`}>
                                  {bedNum}
                                </span>
                                {isOccupied && (
                                  <span className="text-[6px] font-bold truncate uppercase leading-none mt-0.5 text-white block">
                                    {surnameText}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Legenda ed Info */}
                <div className="mt-4 border-t border-slate-200 pt-2 flex justify-between items-center text-[9px] text-slate-500 font-medium uppercase tracking-wider">
                  <div className="flex gap-4 flex-row">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 border border-slate-900 bg-slate-900 rounded-sm"></span>
                      <span className="text-slate-700 font-bold">Occupato (Cognome)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 border border-slate-300 bg-white rounded-sm"></span>
                      <span className="text-slate-700 font-bold">Libero</span>
                    </span>
                  </div>
                  <span>Totale Postazioni Occupate: {bookings.length} / Stampato il {new Date().toLocaleDateString("it-IT")}</span>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
