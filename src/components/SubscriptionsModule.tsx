import React, { useState, useEffect } from "react";
import { db, createBookingTransactional, collection, doc, setDoc, deleteDoc, addDoc, writeBatch, onSnapshot, runTransaction, getDocs, query, where } from "../lib/firebase";
import { 
  getRomeTodayString, 
  formatItalianDate, 
  sanitizeForFirestore,
  getBedLettiniCount,
  getBedItems
} from "../utils";
import { 
  Subscription, 
  Booking, 
  Payment, 
  Customer, 
  LedgerEntry, 
  Attendance,
  PaymentMethod,
  BookingSlot
} from "../types";
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Calendar, 
  Save, 
  ArrowLeft, 
  Check, 
  X, 
  AlertCircle, 
  RefreshCw, 
  Move, 
  Users, 
  Phone, 
  FileText, 
  CreditCard, 
  DollarSign, 
  Clock, 
  Info,
  CalendarDays,
  UserPlus,
  Settings,
  Printer
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface SubscriptionsModuleProps {
  subscriptions: Subscription[];
  bookings: Booking[];
  payments: Payment[];
  customers: Customer[];
  ledger: LedgerEntry[];
  attendance: Attendance[];
  bedsConfig: Record<number, number>;
  rowsConfig: Record<number, number>;
  pricingConfigs: any[];
  subscriptionSetup?: { periods: any[], slotTypes: any[], prezzoMezzaGiornata?: number | null };
  priceList?: { entries: any[] };
  onRefresh?: () => void;
  preSelectedSubId?: string | null;
  onClearPreSelectedSubId?: () => void;
}

export default function SubscriptionsModule({
  subscriptions,
  bookings,
  payments,
  customers,
  ledger,
  attendance,
  bedsConfig,
  rowsConfig,
  pricingConfigs,
  subscriptionSetup = { periods: [], slotTypes: [] },
  priceList = { entries: [] },
  onRefresh,
  preSelectedSubId,
  onClearPreSelectedSubId
}: SubscriptionsModuleProps) {
  // Navigation & Tab state
  const [activeTab, setActiveTab] = useState<"list" | "new" | "setup">("list");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [dealTypeFilter, setDealTypeFilter] = useState<"all" | "seasonal" | "pay_per_day" | "no_subscriptions" | "only_spurious">("all");

  // Form states - NEW CUSTOMER
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustNotes, setNewCustNotes] = useState("");
  const [newCustDealType, setNewCustDealType] = useState<"seasonal" | "pay_per_day">("seasonal");

  // Form states - NEW SUBSCRIPTION PERIOD
  const [showAddPeriodModal, setShowAddPeriodModal] = useState(false);
  const [newPeriodBeds, setNewPeriodBeds] = useState("");
  const [newPeriodStartDate, setNewPeriodStartDate] = useState("");
  const [newPeriodEndDate, setNewPeriodEndDate] = useState("");
  const [newPeriodSlot, setNewPeriodSlot] = useState<BookingSlot>("full_day");
  const [newPeriodPrice, setNewPeriodPrice] = useState(0);
  const [newPeriodPricingRule, setNewPeriodPricingRule] = useState<"standard" | "hotel_weekend">("standard");
  const [newPeriodWeekendRate, setNewPeriodWeekendRate] = useState(25);
  const [newPeriodSoloWeekend, setNewPeriodSoloWeekend] = useState(false);

  // Omonimo / Homonyms states
  const [showOmonimoModal, setShowOmonimoModal] = useState(false);
  const [omonimoMatches, setOmonimoMatches] = useState<Customer[]>([]);

  // Conflict Resolution states
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string, "skip" | "overwrite">>({});
  const [pendingSubscriptionData, setPendingSubscriptionData] = useState<any>(null);

  // Form states - RECORD PAYMENT / LEDGER ENTRY
  const [payAmount, setPayAmount] = useState<number | "">("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payNote, setPayNote] = useState("");
  const [payDate, setPayDate] = useState("");

  // Move Bed Modal State
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveSub, setMoveSub] = useState<Subscription | null>(null);
  const [moveNewBed, setMoveNewBed] = useState("");
  const [moveEffectiveDate, setMoveEffectiveDate] = useState("");

  // Waiver (Rinuncia) Modal State
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [waiverSub, setWaiverSub] = useState<Subscription | null>(null);
  const [waiverStart, setWaiverStart] = useState("");
  const [waiverEnd, setWaiverEnd] = useState("");
  const [waiverCredit, setWaiverCredit] = useState<number | "">("");

  // JSON Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Print Subscribers Modal State
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printStartDate, setPrintStartDate] = useState("2026-06-01");
  const [printEndDate, setPrintEndDate] = useState("2026-09-15");
  const [printPedana, setPrintPedana] = useState<"sinistra" | "destra" | "entrambe">("entrambe");

  // Bulk Import Modal State
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkInputText, setBulkInputText] = useState("");
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [parsingErrors, setParsingErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [ignoreConflicts, setIgnoreConflicts] = useState(false);

  // Edit Ledger Entry Modal State
  const [showEditLedgerModal, setShowEditLedgerModal] = useState(false);
  const [editLedgerEntry, setEditLedgerEntry] = useState<LedgerEntry | null>(null);
  const [editLedgerAmount, setEditLedgerAmount] = useState(0);
  const [editLedgerMethod, setEditLedgerMethod] = useState<PaymentMethod>("cash");
  const [editLedgerDate, setEditLedgerDate] = useState("");
  const [editLedgerNote, setEditLedgerNote] = useState("");

  // Delete Ledger Confirmation State
  const [showDeleteLedgerModal, setShowDeleteLedgerModal] = useState(false);
  const [deleteLedgerEntry, setDeleteLedgerEntry] = useState<LedgerEntry | null>(null);
  const [alsoMarkAbsent, setAlsoMarkAbsent] = useState(false);

  // Edit Customer Notes State
  const [editNotesText, setEditNotesText] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Delete Customer & Bulk Delete States
  const [showDeleteCustomerModal, setShowDeleteCustomerModal] = useState(false);
  const [showDeleteAllNoSubsModal, setShowDeleteAllNoSubsModal] = useState(false);
  const [showDeleteAllSpuriousModal, setShowDeleteAllSpuriousModal] = useState(false);

  // Diagnostic Conflicts state
  const [conflictsList, setConflictsList] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [configHalfDayPrice, setConfigHalfDayPrice] = useState<number | "">("");

  // Bonifica states
  const [showBonificaModal, setShowBonificaModal] = useState(false);
  const [orphanBookings, setOrphanBookings] = useState<any[]>([]);
  const [loadingOrphans, setLoadingOrphans] = useState(false);

  // Daily Presences state & onSnapshot loader
  const [dailyPresences, setDailyPresences] = useState<any[]>([]);

  useEffect(() => {
    const colRef = collection(db, "dailyPresences");
    const unsubscribe = onSnapshot(colRef, (snapshot: any) => {
      const list: any[] = [];
      snapshot.forEach((docSnap: any) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setDailyPresences(list);
    });
    return unsubscribe;
  }, []);

  // Setup Abbonamenti / Dynamic Pricing states
  const [newPeriodId, setNewPeriodId] = useState("");
  const [newPeriodSlotTypeId, setNewPeriodSlotTypeId] = useState("");
  const [newPeriodPriceMode, setNewPeriodPriceMode] = useState<"listino" | "concordato" | "da_concordare">("listino");
  const [newPeriodAgreedPrice, setNewPeriodAgreedPrice] = useState<number | "">("");

  const [gridPrices, setGridPrices] = useState<Record<string, number>>({});

  // Edit Subscription Price/Setup Modal State
  const [showEditSubPriceModal, setShowEditSubPriceModal] = useState(false);
  const [selectedSubForEdit, setSelectedSubForEdit] = useState<Subscription | null>(null);
  const [editSubPeriodId, setEditSubPeriodId] = useState("");
  const [editSubSlotTypeId, setEditSubSlotTypeId] = useState("");
  const [editSubPriceMode, setEditSubPriceMode] = useState<"listino" | "concordato" | "da_concordare">("listino");
  const [editSubAgreedPrice, setEditSubAgreedPrice] = useState<number | "">("");

  // Edit Setup Period Modal State
  const [showEditPeriodModal, setShowEditPeriodModal] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<any>(null);
  const [editPeriodLabel, setEditPeriodLabel] = useState("");
  const [editPeriodStart, setEditPeriodStart] = useState("");
  const [editPeriodEnd, setEditPeriodEnd] = useState("");
  const [editPeriodActive, setEditPeriodActive] = useState(true);

  // Edit Setup SlotType Modal State
  const [showEditSlotTypeModal, setShowEditSlotTypeModal] = useState(false);
  const [editingSlotType, setEditingSlotType] = useState<any>(null);
  const [editSlotTypeCode, setEditSlotTypeCode] = useState("");
  const [editSlotTypeLabel, setEditSlotTypeLabel] = useState("");
  const [editSlotTypeActive, setEditSlotTypeActive] = useState(true);

  // New period / slotType form states (Setup screen)
  const [addPeriodId, setAddPeriodId] = useState("");
  const [addPeriodLabel, setAddPeriodLabel] = useState("");
  const [addPeriodStart, setAddPeriodStart] = useState("");
  const [addPeriodEnd, setAddPeriodEnd] = useState("");

  const [addSlotTypeId, setAddSlotTypeId] = useState("");
  const [addSlotTypeCode, setAddSlotTypeCode] = useState("");
  const [addSlotTypeLabel, setAddSlotTypeLabel] = useState("");

  // Date helper - list of dates YYYY-MM-DD
  const getDatesInRange = (start: string, end: string) => {
    const dates: string[] = [];
    let curr = new Date(start);
    const last = new Date(end);
    while (curr <= last) {
      dates.push(curr.toISOString().split("T")[0]);
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  };

  const dayBefore = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };

  // Cross-linking subscriber detection (e.g. from Daily Map)
  useEffect(() => {
    if (preSelectedSubId) {
      // Find subscription
      const sub = subscriptions.find(s => s.id === preSelectedSubId);
      if (sub && sub.customerId) {
        setSelectedCustomerId(sub.customerId);
        setActiveTab("list");
      }
      if (onClearPreSelectedSubId) {
        onClearPreSelectedSubId();
      }
    }
  }, [preSelectedSubId, subscriptions]);

  // Set default pay date to today in Rome
  useEffect(() => {
    setPayDate(getRomeTodayString());
  }, []);

  // Helper for hotel weekend price calculation
  const computeHotelWeekendPrice = (start: string, end: string, rate: number, bedsStr: string) => {
    if (!start || !end) return 0;
    const beds = bedsStr
      .split(",")
      .map((b) => Number(b.trim()))
      .filter((b) => !isNaN(b) && b > 0);
    const numBeds = beds.length || 1;
    
    const dates = getDatesInRange(start, end);
    let weekendDays = 0;
    dates.forEach((d) => {
      const parts = d.split("-");
      if (parts.length === 3) {
        const year = Number(parts[0]);
        const month = Number(parts[1]) - 1;
        const day = Number(parts[2]);
        const dateObj = new Date(year, month, day);
        const dayOfWeek = dateObj.getDay(); // 0 is Sunday, 6 is Saturday
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekendDays++;
        }
      }
    });
    return weekendDays * rate * numBeds;
  };

  // Keep price updated reactively for hotel pricing rule
  useEffect(() => {
    if (newPeriodPricingRule === "hotel_weekend") {
      const calculated = computeHotelWeekendPrice(
        newPeriodStartDate,
        newPeriodEndDate,
        newPeriodWeekendRate,
        newPeriodBeds
      );
      setNewPeriodPrice(calculated);
    }
  }, [newPeriodPricingRule, newPeriodStartDate, newPeriodEndDate, newPeriodWeekendRate, newPeriodBeds]);

  // Conflict checkers
  const checkConflictsForBeds = (
    bedNumbers: number[],
    startDate: string,
    endDate: string,
    slot: BookingSlot,
    excludeSubId?: string,
    soloWeekend?: boolean
  ) => {
    let dates = getDatesInRange(startDate, endDate);
    if (soloWeekend) {
      dates = dates.filter((d) => {
        const parts = d.split("-");
        if (parts.length === 3) {
          const year = Number(parts[0]);
          const month = Number(parts[1]) - 1;
          const day = Number(parts[2]);
          const dateObj = new Date(year, month, day);
          const dayOfWeek = dateObj.getDay();
          return dayOfWeek === 0 || dayOfWeek === 6;
        }
        return false;
      });
    }
    const conflicts: { id?: string; date: string; bedNumber: number; slot: string; customer: string }[] = [];

    dates.forEach((dt) => {
      const dayBookings = bookings.filter(
        (b) => b.date === dt && bedNumbers.includes(b.bedNumber)
      );
      dayBookings.forEach((b) => {
        if (excludeSubId && b.subscriptionId === excludeSubId) return;

        const isOverlap =
          slot === "full_day" ||
          b.slot === "full_day" ||
          slot === b.slot;
        if (isOverlap) {
          conflicts.push({
            id: b.id,
            date: dt,
            bedNumber: b.bedNumber,
            slot: b.slot,
            customer: b.customerName
          });
        }
      });
    });

    return conflicts;
  };

  // Get effective price of a subscription dynamically
  const getSubscriptionEffectivePrice = (sub: Subscription) => {
    if (!sub.priceMode || sub.priceMode === "listino") {
      if (sub.periodId && sub.slotTypeId) {
        const entries = priceList?.entries || [];
        const entry = entries.find(
          (e: any) => e.periodId === sub.periodId && e.slotTypeId === sub.slotTypeId
        );
        return entry ? entry.price : 0;
      }
      return sub.priceTotal || 0;
    } else if (sub.priceMode === "concordato") {
      return sub.agreedPrice !== null && sub.agreedPrice !== undefined ? Number(sub.agreedPrice) : 0;
    } else if (sub.priceMode === "da_concordare") {
      return 0; // Excluded from expected revenues
    }
    return sub.priceTotal || 0;
  };

  // Compute customer financials
  const getCustomerFinances = (customerId: string) => {
    const activeSubs = subscriptions.filter(
      (s) => s.customerId === customerId && s.status === "active"
    );
    const custLedger = ledger.filter((l) => l.customerId === customerId);

    // Dovuto = Σ price of active seasonal subscriptions + Σ daily_charge kind ledger entries
    const subPriceTotal = activeSubs.reduce((sum, s) => {
      const cust = customers.find(c => c.id === customerId);
      if (cust?.dealType === "pay_per_day") return sum; // Type B pays per daily charges instead
      return sum + (getSubscriptionEffectivePrice(s) || 0);
    }, 0);

    const dailyChargesTotal = custLedger
      .filter((l) => l.kind === "daily_charge")
      .reduce((sum, l) => sum + l.amount, 0);

    const dovuto = subPriceTotal + dailyChargesTotal;

    // Versato = Σ payments + Σ deposits
    const versato = custLedger
      .filter((l) => l.kind === "payment" || l.kind === "deposit")
      .reduce((sum, l) => sum + l.amount, 0);

    // Crediti = Σ day_waiver_credit
    const crediti = custLedger
      .filter((l) => l.kind === "day_waiver_credit")
      .reduce((sum, l) => sum + l.amount, 0);

    const residuo = dovuto - versato - crediti;

    return { dovuto, versato, crediti, residuo };
  };

  // Setup Abbonamenti effects and handlers
  useEffect(() => {
    if (priceList?.entries) {
      const map: Record<string, number> = {};
      priceList.entries.forEach((e: any) => {
        map[`${e.periodId}_${e.slotTypeId}`] = e.price;
      });
      setGridPrices(map);
    }
  }, [priceList]);

  useEffect(() => {
    if (showAddPeriodModal) {
      const activePeriods = (subscriptionSetup?.periods || []).filter((p: any) => p.active);
      const activeSlotTypes = (subscriptionSetup?.slotTypes || []).filter((st: any) => st.active);
      if (activePeriods.length > 0) {
        setNewPeriodId(activePeriods[0].id);
        setNewPeriodStartDate(activePeriods[0].dateStart);
        setNewPeriodEndDate(activePeriods[0].dateEnd);
      } else {
        setNewPeriodId("");
        setNewPeriodStartDate("");
        setNewPeriodEndDate("");
      }
      if (activeSlotTypes.length > 0) {
        setNewPeriodSlotTypeId(activeSlotTypes[0].id);
      } else {
        setNewPeriodSlotTypeId("");
      }
      setNewPeriodPriceMode("listino");
      setNewPeriodAgreedPrice("");
      setNewPeriodSoloWeekend(false);
    }
  }, [showAddPeriodModal, subscriptionSetup]);

  useEffect(() => {
    if (subscriptionSetup && subscriptionSetup.prezzoMezzaGiornata !== undefined && subscriptionSetup.prezzoMezzaGiornata !== null) {
      setConfigHalfDayPrice(subscriptionSetup.prezzoMezzaGiornata);
    }
  }, [subscriptionSetup]);

  useEffect(() => {
    if (newPeriodPriceMode === "listino") {
      if (newPeriodId && newPeriodSlotTypeId) {
        const entries = priceList?.entries || [];
        const entry = entries.find(
          (e: any) => e.periodId === newPeriodId && e.slotTypeId === newPeriodSlotTypeId
        );
        setNewPeriodPrice(entry ? entry.price : 0);
      } else {
        setNewPeriodPrice(0);
      }
    } else if (newPeriodPriceMode === "concordato") {
      setNewPeriodPrice(newPeriodAgreedPrice === "" ? 0 : Number(newPeriodAgreedPrice));
    } else if (newPeriodPriceMode === "da_concordare") {
      setNewPeriodPrice(0);
    }
  }, [newPeriodPriceMode, newPeriodId, newPeriodSlotTypeId, newPeriodAgreedPrice, priceList]);

  const handleAnalyzeBulk = () => {
    setParsingErrors([]);
    setParsedRows([]);
    setIgnoreConflicts(false);
    
    if (!bulkInputText.trim()) {
      setParsingErrors(["L'input non può essere vuoto."]);
      return;
    }

    const lines = bulkInputText.split("\n");
    const tempRows: any[] = [];
    const errors: string[] = [];

    // To check conflict with other items being imported in the SAME batch:
    const tempImported: { bedNumber: number; startDate: string; endDate: string; lineNum: number }[] = [];

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const cleanLine = line.trim();
      if (!cleanLine) return; // skip empty lines

      const parts = cleanLine.split("|");
      if (parts.length !== 4) {
        errors.push(`Riga ${lineNum}: Formato non valido. Deve essere: Nome | Letto | DataInizio | DataFine`);
        return;
      }

      const name = parts[0].trim();
      const bedStr = parts[1].trim();
      const startStr = parts[2].trim();
      const endStr = parts[3].trim();

      if (!name) {
        errors.push(`Riga ${lineNum}: Il nome cliente non può essere vuoto.`);
        return;
      }

      const bedNum = Number(bedStr);
      if (isNaN(bedNum) || bedNum <= 0) {
        errors.push(`Riga ${lineNum}: Numero letto '${bedStr}' non valido. Deve essere un numero intero positivo.`);
        return;
      }

      // Date validation
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startStr)) {
        errors.push(`Riga ${lineNum}: Formato DataInizio '${startStr}' non valido. Deve essere YYYY-MM-DD.`);
        return;
      }
      if (!dateRegex.test(endStr)) {
        errors.push(`Riga ${lineNum}: Formato DataFine '${endStr}' non valido. Deve essere YYYY-MM-DD.`);
        return;
      }

      const startTime = Date.parse(startStr);
      const endTime = Date.parse(endStr);
      if (isNaN(startTime)) {
        errors.push(`Riga ${lineNum}: DataInizio '${startStr}' non valida.`);
        return;
      }
      if (isNaN(endTime)) {
        errors.push(`Riga ${lineNum}: DataFine '${endStr}' non valida.`);
        return;
      }

      if (startStr > endStr) {
        errors.push(`Riga ${lineNum}: La data inizio (${startStr}) non può essere successiva alla data fine (${endStr}).`);
        return;
      }

      // Check if customer exists
      const nameLower = name.toLowerCase().trim();
      const existsInCustomers = customers.some(
        (c) => c.name.toLowerCase().trim() === nameLower
      );
      const existsInSameBatch = tempRows.some(
        (r) => r.customerName.toLowerCase().trim() === nameLower
      );
      const status = (existsInCustomers || existsInSameBatch) ? "Cliente esistente" : "Nuovo cliente";

      // Check conflict:
      // 1. With existing active subscriptions in Firestore
      let conflict = false;
      let conflictReason = "";

      const overlappingSub = subscriptions.find((s) => {
        if (s.status === "cancelled") return false;
        const datesOverlap = s.startDate <= endStr && s.endDate >= startStr;
        const bedMatch = s.bedNumbers.includes(bedNum);
        return datesOverlap && bedMatch;
      });

      if (overlappingSub) {
        conflict = true;
        conflictReason = `Letto già occupato da ${overlappingSub.customerName} (${overlappingSub.startDate} a ${overlappingSub.endDate})`;
      } else {
        // 2. With other rows in the same import
        const sameBatchConflict = tempImported.find((item) => {
          const datesOverlap = item.startDate <= endStr && item.endDate >= startStr;
          const bedMatch = item.bedNumber === bedNum;
          return datesOverlap && bedMatch;
        });

        if (sameBatchConflict) {
          conflict = true;
          conflictReason = `Conflitto interno nella riga ${sameBatchConflict.lineNum} con lo stesso letto ${bedNum} nel periodo ${sameBatchConflict.startDate} a ${sameBatchConflict.endDate}`;
        }
      }

      tempImported.push({
        bedNumber: bedNum,
        startDate: startStr,
        endDate: endStr,
        lineNum,
      });

      tempRows.push({
        lineNum,
        customerName: name,
        bedNumber: bedNum,
        startDate: startStr,
        endDate: endStr,
        status,
        conflict,
        conflictReason,
      });
    });

    if (errors.length > 0) {
      setParsingErrors(errors);
      setParsedRows([]);
    } else {
      setParsedRows(tempRows);
    }
  };

  const handleConfirmBulkImport = async () => {
    if (parsedRows.length === 0) return;

    const hasConflicts = parsedRows.some((r) => r.conflict);
    if (hasConflicts && !ignoreConflicts) {
      setErrorMessage("Risolvi i conflitti o seleziona 'Importa comunque ignorando i conflitti' per procedere.");
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await runTransaction(db, async (tx) => {
        const localNewCustomersMap: { [nameLower: string]: string } = {};

        for (const row of parsedRows) {
          const nameLower = row.customerName.toLowerCase().trim();
          let customerId = "";

          const existingCust = customers.find(
            (c) => c.name.toLowerCase().trim() === nameLower
          );

          if (existingCust) {
            customerId = existingCust.id!;
          } else if (localNewCustomersMap[nameLower]) {
            customerId = localNewCustomersMap[nameLower];
          } else {
            const newId = `customer_${Math.random().toString(36).substring(2, 11)}`;
            const customerRef = doc(db, `customers/${newId}`);
            customerId = newId;
            localNewCustomersMap[nameLower] = newId;

            const customerData = sanitizeForFirestore({
              name: row.customerName.trim(),
              phone: "",
              notes: "Creato tramite Importazione Massiva",
              type: "subscriber",
            });

            tx.set(customerRef, customerData);
          }

          const subId = `sub_bulk_${Math.random().toString(36).substring(2, 11)}`;
          const subRef = doc(db, `subscriptions/${subId}`);

          const subscriptionData = sanitizeForFirestore({
            customerId,
            customerName: row.customerName.trim(),
            customerPhone: "",
            bedNumbers: [row.bedNumber],
            startDate: row.startDate,
            endDate: row.endDate,
            slot: "full_day",
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            priceTotal: 0,
            priceMode: "da_concordare",
            agreedPrice: null,
            status: "active",
            notes: "Importazione Massiva",
            createdAt: new Date().toISOString()
          });

          tx.set(subRef, subscriptionData);
        }
      });

      setSuccessMessage(`Importazione completata con successo! Inseriti ${parsedRows.length} abbonamenti.`);
      setShowBulkImportModal(false);
      setBulkInputText("");
      setParsedRows([]);
      setParsingErrors([]);
    } catch (err: any) {
      console.error("Errore durante l'importazione massiva:", err);
      setErrorMessage(`Errore durante l'importazione: ${err.message || String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleGeneratePDF = () => {
    const formatDateDM = (dateStr: string) => {
      if (!dateStr) return "";
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}`;
      }
      return dateStr;
    };

    const formatDateFull = (dateStr: string) => {
      if (!dateStr) return "";
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    };

    const getFormattedNow = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };

    // Map to group active subscriptions by customerId (fallback to customerName)
    const customerGroups = new Map<string, {
      customerName: string;
      subs: Subscription[];
    }>();

    subscriptions.forEach((sub) => {
      // 1. Only active status
      if (sub.status !== "active") return;

      // 2. Overlap dates filter
      const overlaps = sub.startDate <= printEndDate && sub.endDate >= printStartDate;
      if (!overlaps) return;

      // 3. Pedana filter
      let matchesPedana = false;
      if (printPedana === "entrambe") {
        matchesPedana = true;
      } else {
        matchesPedana = sub.bedNumbers.some((bNum) => {
          if (printPedana === "sinistra" && bNum <= 34) return true;
          if (printPedana === "destra" && bNum >= 60) return true;
          return false;
        });
      }
      if (!matchesPedana) return;

      const cId = sub.customerId || sub.customerName || "sconosciuto";
      if (!customerGroups.has(cId)) {
        customerGroups.set(cId, {
          customerName: sub.customerName || "Cliente",
          subs: []
        });
      }
      customerGroups.get(cId)!.subs.push(sub);
    });

    let grandTotal = 0;
    let clientsCount = 0;

    // Sort by Customer Name (alphabetically)
    const sortedGroups = Array.from(customerGroups.values()).sort((a, b) => 
      a.customerName.localeCompare(b.customerName, "it", { sensitivity: "base" })
    );

    const tableBody = sortedGroups.map((group) => {
      clientsCount++;

      // Union of bedNumbers, filtered by selected pedana, sorted
      const bedNumbersSet = new Set<number>();
      group.subs.forEach(s => {
        s.bedNumbers.forEach(bNum => {
          if (printPedana === "sinistra" && bNum > 34) return;
          if (printPedana === "destra" && bNum < 60) return;
          bedNumbersSet.add(bNum);
        });
      });
      const sortedBeds = Array.from(bedNumbersSet).sort((a, b) => a - b);
      const bedNumbersStr = sortedBeds.join(", ");

      // Periods of their cards, listed
      const periodStrings = group.subs.map(s => `${formatDateDM(s.startDate)} - ${formatDateDM(s.endDate)}`);
      const uniquePeriods = Array.from(new Set(periodStrings));
      const periodsStr = uniquePeriods.join(", ");

      // Cost: sum of effective prices as shown in UI
      let hasAnyPrice = false;
      let customerTotalCost = 0;
      group.subs.forEach(s => {
        const cust = customers.find(c => c.id === s.customerId);
        const isPayPerDay = cust?.dealType === "pay_per_day";
        const isDaConcordare = s.priceMode === "da_concordare";
        if (!isPayPerDay && !isDaConcordare) {
          hasAnyPrice = true;
          customerTotalCost += getSubscriptionEffectivePrice(s) || 0;
        }
      });

      if (hasAnyPrice) {
        grandTotal += customerTotalCost;
      }

      const costDisplay = hasAnyPrice ? `${customerTotalCost} €` : "";

      return [
        group.customerName,
        bedNumbersStr,
        periodsStr,
        costDisplay
      ];
    });

    // Create landscape A4 PDF document
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });

    const drawHeader = (pageNumber: number) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(2, 90, 112); // #025A70
      doc.text("LIDO SAMARINDA", 14, 15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text("ELENCO ABBONATI", 14, 21);

      const periodStr = `Periodo Selezionato: ${formatDateDM(printStartDate)} - ${formatDateDM(printEndDate)}`;
      doc.text(periodStr, 14, 27);

      const genTimeStr = `Generato il: ${getFormattedNow()}`;
      doc.text(genTimeStr, 220, 27);

      doc.setDrawColor(226, 232, 240);
      doc.line(14, 31, 283, 31);
    };

    autoTable(doc, {
      startY: 38,
      head: [["Cliente", "Ombrelloni", "Periodo", "Costo (€)"]],
      body: tableBody,
      foot: [[`Totale Clienti: ${clientsCount}`, "", "TOTALE:", `${grandTotal} €`]],
      theme: "striped",
      headStyles: { fillColor: [2, 90, 112] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 90 }, // Cliente
        1: { cellWidth: 50 }, // Ombrelloni
        2: { cellWidth: 89 }, // Periodo
        3: { cellWidth: 40, halign: "right" }, // Costo
      },
      margin: { top: 38, left: 14, right: 14, bottom: 14 },
      didDrawPage: (data) => {
        drawHeader(data.pageNumber);
      }
    });

    doc.save(`elenco_abbonati_${printStartDate}_${printEndDate}.pdf`);
    setShowPrintModal(false);
  };

  const handleNewPeriodIdChange = (pId: string) => {
    setNewPeriodId(pId);
    const periods = subscriptionSetup?.periods || [];
    const pObj = periods.find((p: any) => p.id === pId);
    if (pObj) {
      setNewPeriodStartDate(pObj.dateStart);
      setNewPeriodEndDate(pObj.dateEnd);
    }
  };

  const handleCreatePeriod = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanId = addPeriodId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanId) {
      setErrorMessage("ID periodo non valido.");
      return;
    }
    const periods = subscriptionSetup?.periods || [];
    if (periods.some((p: any) => p.id === cleanId)) {
      setErrorMessage("Un periodo con questo ID esiste già.");
      return;
    }
    const newPeriod = {
      id: cleanId,
      label: addPeriodLabel.trim(),
      dateStart: addPeriodStart,
      dateEnd: addPeriodEnd,
      active: true,
    };
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        periods: [...periods, newPeriod],
      });
      setSuccessMessage("Periodo creato con successo.");
      setAddPeriodId("");
      setAddPeriodLabel("");
      setAddPeriodStart("");
      setAddPeriodEnd("");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio del periodo: " + err.message);
    }
  };

  const handleDeletePeriod = async (periodId: string) => {
    const referenced = subscriptions.some((s) => s.periodId === periodId);
    const periods = subscriptionSetup?.periods || [];
    if (referenced) {
      const updatedPeriods = periods.map((p: any) =>
        p.id === periodId ? { ...p, active: false } : p
      );
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        periods: updatedPeriods,
      });
      setSuccessMessage("Il periodo è utilizzato da uno o più abbonati. È stato disattivato (active: false) anziché eliminato fisicamente.");
      setTimeout(() => setSuccessMessage(null), 6000);
    } else {
      const updatedPeriods = periods.filter((p: any) => p.id !== periodId);
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        periods: updatedPeriods,
      });
      setSuccessMessage("Periodo eliminato con successo.");
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  const handleSavePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPeriod) return;
    const periods = subscriptionSetup?.periods || [];
    const updatedPeriods = periods.map((p: any) =>
      p.id === editingPeriod.id
        ? {
            ...p,
            label: editPeriodLabel,
            dateStart: editPeriodStart,
            dateEnd: editPeriodEnd,
            active: editPeriodActive,
          }
        : p
    );
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        periods: updatedPeriods,
      });
      setSuccessMessage("Periodo aggiornato con successo.");
      setShowEditPeriodModal(false);
      setEditingPeriod(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nell'aggiornamento del periodo: " + err.message);
    }
  };

  const handleCreateSlotType = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanId = addSlotTypeId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanId) {
      setErrorMessage("ID tipologia non valido.");
      return;
    }
    const slotTypes = subscriptionSetup?.slotTypes || [];
    if (slotTypes.some((st: any) => st.id === cleanId)) {
      setErrorMessage("Una tipologia con questo ID esiste già.");
      return;
    }
    const newSlotType = {
      id: cleanId,
      code: addSlotTypeCode.trim().toUpperCase(),
      label: addSlotTypeLabel.trim(),
      active: true,
    };
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        slotTypes: [...slotTypes, newSlotType],
      });
      setSuccessMessage("Tipologia creata con successo.");
      setAddSlotTypeId("");
      setAddSlotTypeCode("");
      setAddSlotTypeLabel("");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio della tipologia: " + err.message);
    }
  };

  const handleDeleteSlotType = async (slotTypeId: string) => {
    const referenced = subscriptions.some((s) => s.slotTypeId === slotTypeId);
    const slotTypes = subscriptionSetup?.slotTypes || [];
    if (referenced) {
      const updatedSlotTypes = slotTypes.map((st: any) =>
        st.id === slotTypeId ? { ...st, active: false } : st
      );
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        slotTypes: updatedSlotTypes,
      });
      setSuccessMessage("La tipologia è utilizzata da uno o più abbonati. È stata disattivata (active: false) anziché eliminata fisicamente.");
      setTimeout(() => setSuccessMessage(null), 6000);
    } else {
      const updatedSlotTypes = slotTypes.filter((st: any) => st.id !== slotTypeId);
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        slotTypes: updatedSlotTypes,
      });
      setSuccessMessage("Tipologia eliminata con successo.");
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  const handleSaveSlotType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlotType) return;
    const slotTypes = subscriptionSetup?.slotTypes || [];
    const updatedSlotTypes = slotTypes.map((st: any) =>
      st.id === editingSlotType.id
        ? {
            ...st,
            code: editSlotTypeCode,
            label: editSlotTypeLabel,
            active: editSlotTypeActive,
          }
        : st
    );
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        slotTypes: updatedSlotTypes,
      });
      setSuccessMessage("Tipologia aggiornata con successo.");
      setShowEditSlotTypeModal(false);
      setEditingSlotType(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nell'aggiornamento della tipologia: " + err.message);
    }
  };

  const handleTogglePeriodActive = async (periodId: string, active: boolean) => {
    const periods = subscriptionSetup?.periods || [];
    const updated = periods.map((p: any) =>
      p.id === periodId ? { ...p, active } : p
    );
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        periods: updated,
      });
      setSuccessMessage(`Periodo ${active ? "attivato" : "disattivato"} con successo.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore: " + err.message);
    }
  };

  const handleToggleSlotTypeActive = async (slotTypeId: string, active: boolean) => {
    const slotTypes = subscriptionSetup?.slotTypes || [];
    const updated = slotTypes.map((st: any) =>
      st.id === slotTypeId ? { ...st, active } : st
    );
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        slotTypes: updated,
      });
      setSuccessMessage(`Tipologia ${active ? "attivata" : "disattivata"} con successo.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore: " + err.message);
    }
  };

  const handleSavePriceList = async () => {
    try {
      const entries: any[] = [];
      Object.entries(gridPrices).forEach(([key, price]) => {
        if (price !== "" && price !== null && price !== undefined && !isNaN(Number(price))) {
          const [periodId, slotTypeId] = key.split("_");
          entries.push({ periodId, slotTypeId, price: Number(price) });
        }
      });
      await setDoc(doc(db, "config", "priceList"), { entries });
      setSuccessMessage("Listino prezzi salvato con successo!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio del listino: " + err.message);
    }
  };

  const handleSaveHalfDayPrice = async () => {
    if (configHalfDayPrice === "" || isNaN(Number(configHalfDayPrice))) {
      setErrorMessage("Inserisci un prezzo valido per la mezza giornata (in centesimi).");
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await setDoc(doc(db, "config", "subscriptionSetup"), {
        ...subscriptionSetup,
        prezzoMezzaGiornata: Math.round(Number(configHalfDayPrice))
      });
      setSuccessMessage("Prezzo mezza giornata salvato con successo!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio del prezzo mezza giornata: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSubPriceAndSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubForEdit || !selectedSubForEdit.id) return;
    
    setSaving(true);
    setErrorMessage(null);
    try {
      const updatedSub = {
        ...selectedSubForEdit,
        periodId: editSubPeriodId || undefined,
        slotTypeId: editSubSlotTypeId || undefined,
        priceMode: editSubPriceMode,
        agreedPrice: editSubPriceMode === "concordato" ? (editSubAgreedPrice === "" ? null : Number(editSubAgreedPrice)) : null,
      };

      // Also calculate dynamic price for fallback
      const currentPrice = getSubscriptionEffectivePrice(updatedSub as any);
      updatedSub.priceTotal = currentPrice || 0;

      await setDoc(doc(db, "subscriptions", selectedSubForEdit.id), sanitizeForFirestore(updatedSub));
      
      setSuccessMessage("Prezzo/Setup abbonamento aggiornato con successo.");
      setShowEditSubPriceModal(false);
      setSelectedSubForEdit(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nell'aggiornamento dell'abbonamento: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Add new customer
  const handleCreateCustomer = async (e?: React.FormEvent, bypassCheck = false) => {
    if (e) e.preventDefault();
    if (!newCustName.trim()) {
      setErrorMessage("Il nome del cliente è obbligatorio.");
      return;
    }

    const normInput = newCustName.trim().toLowerCase().replace(/\s+/g, ' ');
    const matches = customers.filter(c => c.name.trim().toLowerCase().replace(/\s+/g, ' ') === normInput);

    if (matches.length > 0 && !bypassCheck) {
      setOmonimoMatches(matches);
      setShowOmonimoModal(true);
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const custRef = doc(collection(db, "customers"));
      const newCust: Customer = {
        name: newCustName.trim(),
        phone: newCustPhone.trim() || undefined,
        notes: newCustNotes.trim() || undefined,
        type: "subscriber",
        dealType: newCustDealType,
        createdAt: new Date().toISOString()
      };

      await setDoc(custRef, sanitizeForFirestore(newCust));
      setSelectedCustomerId(custRef.id);
      setActiveTab("list");
      
      // Clear fields
      setNewCustName("");
      setNewCustPhone("");
      setNewCustNotes("");
      setSuccessMessage("Cliente creato con successo!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio del cliente: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectExistingOmonimo = (existingId: string) => {
    setSelectedCustomerId(existingId);
    setActiveTab("list");
    setShowOmonimoModal(false);
    
    // Clear fields
    setNewCustName("");
    setNewCustPhone("");
    setNewCustNotes("");
    
    // Proactively open the add period modal
    setShowAddPeriodModal(true);
    setSuccessMessage("Collegato al cliente esistente. Compila il nuovo periodo.");
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const executeSubscriptionSave = async (
    subData: {
      customerId: string;
      beds: number[];
      startDate: string;
      endDate: string;
      slot: BookingSlot;
      priceTotal: number;
      pricingRule: "standard" | "hotel_weekend";
      weekendRate?: number;
      periodId?: string;
      slotTypeId?: string;
      priceMode?: "listino" | "concordato" | "da_concordare";
      agreedPrice?: number | null | "";
      soloWeekend?: boolean;
    },
    conflicts: any[],
    decisions: Record<string, "skip" | "overwrite">
  ) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const customer = customers.find((c) => c.id === subData.customerId);
      if (!customer) throw new Error("Cliente non trovato");

      // Create Subscription
      const subRef = doc(collection(db, "subscriptions"));
      const newSub: Subscription = {
        customerId: subData.customerId,
        customerName: customer.name,
        customerPhone: customer.phone,
        bedNumbers: subData.beds,
        startDate: subData.startDate,
        endDate: subData.endDate,
        slot: subData.slot,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7], // default all
        priceTotal: subData.priceTotal,
        periodId: subData.periodId || undefined,
        slotTypeId: subData.slotTypeId || undefined,
        priceMode: subData.priceMode || "listino",
        agreedPrice: subData.priceMode === "concordato" ? (subData.agreedPrice === "" || subData.agreedPrice === undefined ? null : Number(subData.agreedPrice)) : null,
        status: "active",
        notes: "",
        createdAt: new Date().toISOString(),
        pricingRule: subData.pricingRule,
        weekendRate: subData.weekendRate,
        soloWeekend: subData.soloWeekend || false
      };

      await setDoc(subRef, sanitizeForFirestore(newSub));

      // Create Bookings
      let dates = getDatesInRange(subData.startDate, subData.endDate);
      if (subData.soloWeekend) {
        dates = dates.filter((d) => {
          const parts = d.split("-");
          if (parts.length === 3) {
            const year = Number(parts[0]);
            const month = Number(parts[1]) - 1;
            const day = Number(parts[2]);
            const dateObj = new Date(year, month, day);
            const dayOfWeek = dateObj.getDay();
            return dayOfWeek === 0 || dayOfWeek === 6;
          }
          return false;
        });
      }
      let countCreated = 0;
      let countSkipped = 0;
      let countOverwritten = 0;

      let batch = writeBatch(db);
      let opCount = 0;

      for (const dt of dates) {
        for (const bNum of subData.beds) {
          // Check if there is a conflict for this specific bed and date
          const matchConflict = conflicts.find(
            (c) => c.date === dt && c.bedNumber === bNum
          );

          let isOverwrite = false;
          if (matchConflict) {
            const decision = decisions[matchConflict.id] || "skip";
            if (decision === "skip") {
              countSkipped++;
              continue; // Skip creating booking
            } else {
              isOverwrite = true;
              countOverwritten++;
            }
          } else {
            countCreated++;
          }

          // If overwrite and a valid conflict ID exists, delete existing booking
          if (isOverwrite && matchConflict.id) {
            batch.delete(doc(db, "bookings", matchConflict.id));
            opCount++;
            if (opCount >= 450) {
              await batch.commit();
              batch = writeBatch(db);
              opCount = 0;
            }
          }

          // Create Booking using deterministic ID
          const slotKey = subData.slot === "full_day" ? "full" : subData.slot;
          const bookingId = `${dt}_${bNum}_${slotKey}`;
          const bookingRef = doc(db, "bookings", bookingId);

          const numLettini = getBedLettiniCount(bNum, bedsConfig);
          const defaultItems = getBedItems(bNum, numLettini);
          const risorse = [{ postazione: bNum, items: defaultItems }];

          const finalBooking: Booking = {
            id: bookingId,
            bedNumber: bNum,
            date: dt,
            slot: subData.slot,
            tipoPrenotazione: "intera",
            risorse: risorse,
            customerId: subData.customerId,
            customerName: customer.name,
            customerPhone: customer.phone || "",
            customerType: "subscriber",
            subscriptionId: subRef.id,
            source: "subscription",
            notes: "",
            isConfirmedPayPerDay: customer.dealType === "pay_per_day" ? false : true,
            dealType: customer.dealType,
            createdAt: new Date().toISOString()
          };

          batch.set(bookingRef, sanitizeForFirestore(finalBooking));
          opCount++;

          if (opCount >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }

      // Commit any remaining operations
      if (opCount > 0) {
        await batch.commit();
      }

      setShowAddPeriodModal(false);
      setShowConflictModal(false);
      setNewPeriodBeds("");
      setNewPeriodStartDate("");
      setNewPeriodEndDate("");
      setNewPeriodPrice(0);
      setNewPeriodPricingRule("standard");
      setNewPeriodSoloWeekend(false);
      setPendingSubscriptionData(null);
      setConflictDecisions({});
      setConflictsList([]);

      const totalCreated = countCreated + countOverwritten;
      setSuccessMessage(`Abbonamento aggiunto con successo! Prenotazioni create: ${totalCreated} (sovrascritte: ${countOverwritten}), saltate: ${countSkipped}.`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setErrorMessage("Errore nel salvataggio del periodo: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Add a subscription period to a customer
  const handleAddPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;

    const beds = newPeriodBeds
      .split(",")
      .map((b) => Number(b.trim()))
      .filter((b) => !isNaN(b) && b > 0);

    if (beds.length === 0) {
      setErrorMessage("Specificare almeno un ombrellone valido.");
      return;
    }
    if (!newPeriodStartDate || !newPeriodEndDate) {
      setErrorMessage("Le date di inizio e fine sono obbligatorie.");
      return;
    }
    if (newPeriodStartDate > newPeriodEndDate) {
      setErrorMessage("La data di inizio non può essere successiva alla data di fine.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setConflictsList([]);

    try {
      // 1. Conflict Check
      const conflicts = checkConflictsForBeds(
        beds,
        newPeriodStartDate,
        newPeriodEndDate,
        newPeriodSlot,
        undefined,
        newPeriodSoloWeekend
      );

      const subData = {
        customerId: selectedCustomerId,
        beds,
        startDate: newPeriodStartDate,
        endDate: newPeriodEndDate,
        slot: newPeriodSlot,
        priceTotal: newPeriodPrice,
        pricingRule: newPeriodPricingRule,
        weekendRate: newPeriodPricingRule === "hotel_weekend" ? newPeriodWeekendRate : undefined,
        periodId: newPeriodId || undefined,
        slotTypeId: newPeriodSlotTypeId || undefined,
        priceMode: newPeriodPriceMode,
        agreedPrice: newPeriodPriceMode === "concordato" ? (newPeriodAgreedPrice === "" ? null : Number(newPeriodAgreedPrice)) : null,
        soloWeekend: newPeriodSoloWeekend
      };

      if (conflicts.length > 0) {
        setConflictsList(conflicts);
        setPendingSubscriptionData(subData);
        
        // Initialize decisions as "skip" for each conflict ID
        const initialDecisions: Record<string, "skip" | "overwrite"> = {};
        conflicts.forEach(c => {
          if (c.id) {
            initialDecisions[c.id] = "skip";
          }
        });
        setConflictDecisions(initialDecisions);
        setShowConflictModal(true);
        setSaving(false);
        return;
      }

      // No conflicts: proceed immediately
      await executeSubscriptionSave(subData, [], {});
    } catch (err: any) {
      setErrorMessage("Errore: " + err.message);
      setSaving(false);
    }
  };

  // Sposta Ombrellone / Migration
  const handleMoveSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveSub || !moveNewBed.trim() || !moveEffectiveDate) return;

    const newBedNum = Number(moveNewBed.trim());
    if (isNaN(newBedNum) || newBedNum <= 0) {
      setErrorMessage("Ombrellone di destinazione non valido.");
      return;
    }

    if (moveEffectiveDate < moveSub.startDate || moveEffectiveDate > moveSub.endDate) {
      setErrorMessage("La decorrenza deve essere compresa nel periodo dell'abbonamento.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setConflictsList([]);

    try {
      // 1. Conflict Check on new bed from effective date to endDate
      const conflicts = checkConflictsForBeds(
        [newBedNum],
        moveEffectiveDate,
        moveSub.endDate,
        moveSub.slot,
        moveSub.id
      );

      if (conflicts.length > 0) {
        setConflictsList(conflicts);
        setErrorMessage("Impossibile effettuare lo spostamento: l'ombrellone di destinazione è occupato.");
        setSaving(false);
        return;
      }

      const customer = customers.find((c) => c.id === moveSub.customerId);
      if (!customer) throw new Error("Cliente non trovato");

      // 2. Perform Move & Split
      const originalEndDate = moveSub.endDate;
      const originalPrice = moveSub.priceTotal;
      const originalDays = getDatesInRange(moveSub.startDate, moveSub.endDate).length;
      const splitDateBefore = dayBefore(moveEffectiveDate);
      const daysOldSub = getDatesInRange(moveSub.startDate, splitDateBefore).length;
      const daysNewSub = getDatesInRange(moveEffectiveDate, originalEndDate).length;

      // Proportional pricing split
      const priceOldSub = Math.round((originalPrice * daysOldSub) / originalDays);
      const priceNewSub = originalPrice - priceOldSub;

      // Update old sub endDate
      await setDoc(doc(db, "subscriptions", moveSub.id!), {
        endDate: splitDateBefore,
        priceTotal: priceOldSub
      }, { merge: true });

      // Create new sub for remaining days on new bed
      const newSubRef = doc(collection(db, "subscriptions"));
      const migratedSub: Subscription = {
        customerId: moveSub.customerId,
        customerName: moveSub.customerName,
        customerPhone: moveSub.customerPhone,
        bedNumbers: [newBedNum],
        startDate: moveEffectiveDate,
        endDate: originalEndDate,
        slot: moveSub.slot,
        daysOfWeek: moveSub.daysOfWeek || [1, 2, 3, 4, 5, 6, 7],
        priceTotal: priceNewSub,
        status: "active",
        notes: `Spostamento da ombrellone ${moveSub.bedNumbers.join(", ")}`,
        createdAt: new Date().toISOString()
      };
      await setDoc(newSubRef, sanitizeForFirestore(migratedSub));

      // 3. Delete old bookings from decorrenza onwards
      const querySnap: any = await getDocs(query(collection(db, "bookings"), where("subscriptionId", "==", moveSub.id)));
      const fetchedBookings = querySnap.docs.map((d: any) => ({
        id: d.id,
        ...d.data()
      }));

      const oldBookingsToDelete = fetchedBookings.filter(
        (b: any) => b.date >= moveEffectiveDate
      );

      let deletedCount = 0;
      if (oldBookingsToDelete.length > 0) {
        const chunkSize = 400;
        for (let i = 0; i < oldBookingsToDelete.length; i += chunkSize) {
          const chunk = oldBookingsToDelete.slice(i, i + chunkSize);
          const batch = writeBatch(db);
          for (const b of chunk) {
            batch.delete(doc(db, "bookings", b.id));
            deletedCount++;
          }
          await batch.commit();
        }
      }

      // 4. Generate new bookings on new bed from decorrenza onwards
      const newDates = getDatesInRange(moveEffectiveDate, originalEndDate);
      for (const dt of newDates) {
        const bookingData = {
          customerName: customer.name,
          customerPhone: customer.phone || "",
          customerType: "subscriber" as const,
          bedNumber: newBedNum,
          date: dt,
          slot: moveSub.slot,
          source: "subscription" as const,
          subscriptionId: newSubRef.id,
          customerId: moveSub.customerId,
          isConfirmedPayPerDay: customer.dealType === "pay_per_day" ? false : true,
          dealType: customer.dealType
        };
        await createBookingTransactional(bookingData);
      }

      setShowMoveModal(false);
      setMoveSub(null);
      setMoveNewBed("");
      setMoveEffectiveDate("");
      setSuccessMessage(`Spostamento completato con successo. ${deletedCount} prenotazioni eliminate.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante lo spostamento: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Waiver (Rinuncia) Days Credit
  const handleWaiverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiverSub || !waiverStart || !waiverEnd || waiverCredit === "") return;

    if (waiverStart < waiverSub.startDate || waiverEnd > waiverSub.endDate) {
      setErrorMessage("La rinuncia deve essere all'interno del periodo di abbonamento.");
      return;
    }
    if (waiverStart > waiverEnd) {
      setErrorMessage("La data inizio non può superare la data fine.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const waivedDates = getDatesInRange(waiverStart, waiverEnd);
      const totalWaivedDays = waivedDates.length;

      // 1. Delete matching bookings by querying Firestore directly
      const querySnap: any = await getDocs(query(collection(db, "bookings"), where("subscriptionId", "==", waiverSub.id)));
      const fetchedBookings = querySnap.docs.map((d: any) => ({
        id: d.id,
        ...d.data()
      }));

      const bookingsToWaiver = fetchedBookings.filter(
        (b: any) => b.date >= waiverStart && b.date <= waiverEnd
      );

      let deletedCount = 0;
      if (bookingsToWaiver.length > 0) {
        const chunkSize = 400;
        for (let i = 0; i < bookingsToWaiver.length; i += chunkSize) {
          const chunk = bookingsToWaiver.slice(i, i + chunkSize);
          const batch = writeBatch(db);
          for (const b of chunk) {
            batch.delete(doc(db, "bookings", b.id));
            deletedCount++;
          }
          await batch.commit();
        }
      }

      // 2. Write Ledger waiver credit
      const ledgerRef = doc(collection(db, "ledger"));
      const ledgerEntry: LedgerEntry = {
        customerId: waiverSub.customerId,
        subscriptionId: waiverSub.id,
        kind: "day_waiver_credit",
        amount: Number(waiverCredit),
        date: getRomeTodayString(),
        note: `Rinuncia ${formatItalianDate(waiverStart)} - ${formatItalianDate(waiverEnd)} (${totalWaivedDays} gg)`,
        createdAt: new Date().toISOString()
      };
      await setDoc(ledgerRef, sanitizeForFirestore(ledgerEntry));

      setShowWaiverModal(false);
      setWaiverSub(null);
      setWaiverStart("");
      setWaiverEnd("");
      setWaiverCredit("");
      setSuccessMessage(`Rinuncia registrata. ${deletedCount} prenotazioni eliminate.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante la rinuncia: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Autocalculate proportional waiver amount
  useEffect(() => {
    if (waiverSub && waiverStart && waiverEnd) {
      const subDates = getDatesInRange(waiverSub.startDate, waiverSub.endDate).length;
      const waivedDates = getDatesInRange(waiverStart, waiverEnd).length;
      if (subDates > 0 && waivedDates > 0) {
        const proportional = Math.round(((waiverSub.priceTotal || 0) / subDates) * waivedDates);
        setWaiverCredit(proportional);
      }
    }
  }, [waiverStart, waiverEnd, waiverSub]);

  // Cancel/Delete entire Subscription period
  const handleCancelSubscription = async (sub: Subscription) => {
    if (!sub.id) return;
    setSaving(true);
    setErrorMessage(null);

    try {
      // 1. Mark subscription cancelled
      await setDoc(doc(db, "subscriptions", sub.id), {
        status: "cancelled"
      }, { merge: true });

      // 2. Delete future bookings by querying Firestore directly
      const querySnap: any = await getDocs(query(collection(db, "bookings"), where("subscriptionId", "==", sub.id)));
      const fetchedBookings = querySnap.docs.map((d: any) => ({
        id: d.id,
        ...d.data()
      }));

      const today = getRomeTodayString();
      const bookingsToCancel = fetchedBookings.filter(
        (b: any) => b.date >= today
      );

      let deletedCount = 0;
      if (bookingsToCancel.length > 0) {
        const chunkSize = 400;
        for (let i = 0; i < bookingsToCancel.length; i += chunkSize) {
          const chunk = bookingsToCancel.slice(i, i + chunkSize);
          const batch = writeBatch(db);
          for (const b of chunk) {
            batch.delete(doc(db, "bookings", b.id));
            deletedCount++;
          }
          await batch.commit();
        }
      }

      setSuccessMessage(`Abbonamento disdetto. ${deletedCount} prenotazioni eliminate.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nella disdetta: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Search for orphaned bookings
  const handleSearchOrphanBookings = async () => {
    setLoadingOrphans(true);
    setErrorMessage(null);
    try {
      // 1. Fetch all bookings
      const bookingsSnap: any = await getDocs(collection(db, "bookings"));
      const allBookings = bookingsSnap.docs.map((d: any) => ({
        id: d.id,
        ...d.data()
      }));
      const subBookings = allBookings.filter(b => b.subscriptionId && b.subscriptionId.trim() !== "");

      // 2. Fetch all subscriptions
      const subsSnap: any = await getDocs(collection(db, "subscriptions"));
      const subsList = subsSnap.docs.map((d: any) => ({
        id: d.id,
        ...d.data()
      }));
      const subsMap = new Map(subsList.map(s => [s.id, s]));

      // 3. Find orphans (either subscription doesn't exist, or exists but is cancelled)
      const orphans = subBookings.filter(b => {
        const refSub = subsMap.get(b.subscriptionId) as any;
        if (!refSub) return true; // Does not exist
        if (refSub.status === "cancelled") return true; // Cancelled
        return false;
      });

      setOrphanBookings(orphans);
      setShowBonificaModal(true);
    } catch (err: any) {
      setErrorMessage("Errore durante la ricerca di prenotazioni orfane: " + err.message);
    } finally {
      setLoadingOrphans(false);
    }
  };

  // Execute deletion of orphaned bookings
  const handleExecuteBonifica = async () => {
    if (orphanBookings.length === 0) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      let deletedCount = 0;
      const chunkSize = 400;
      for (let i = 0; i < orphanBookings.length; i += chunkSize) {
        const chunk = orphanBookings.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const b of chunk) {
          batch.delete(doc(db, "bookings", b.id));
          deletedCount++;
        }
        await batch.commit();
      }

      setShowBonificaModal(false);
      setOrphanBookings([]);
      setSuccessMessage(`Bonifica completata con successo. ${deletedCount} prenotazioni eliminate.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante l'eliminazione delle prenotazioni orfane: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Add ledger entries (Payments/Deposits/Adjustments)
  const handleAddLedgerEntry = async (e: React.FormEvent, kind: "payment" | "deposit" | "adjustment") => {
    e.preventDefault();
    if (!selectedCustomerId || payAmount === "") return;

    setSaving(true);
    setErrorMessage(null);

    try {
      const ledgerRef = doc(collection(db, "ledger"));
      const newEntry: LedgerEntry = {
        customerId: selectedCustomerId,
        kind,
        amount: Number(payAmount),
        method: kind !== "adjustment" ? payMethod : undefined,
        date: payDate,
        note: payNote.trim() || undefined,
        createdAt: new Date().toISOString()
      };

      await setDoc(ledgerRef, sanitizeForFirestore(newEntry));
      
      setPayAmount("");
      setPayNote("");
      setSuccessMessage("Movimento contabile registrato con successo!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore nella registrazione: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete ledger entry
  const handleDeleteLedgerConfirm = async () => {
    if (!deleteLedgerEntry?.id) return;
    setSaving(true);
    setErrorMessage(null);

    try {
      // Delete the ledger entry
      await deleteDoc(doc(db, "ledger", deleteLedgerEntry.id));

      // Special action for daily_charge generated from attendance
      if (deleteLedgerEntry.kind === "daily_charge" && alsoMarkAbsent) {
        const attId = `${deleteLedgerEntry.date}_${deleteLedgerEntry.customerId}`;
        // Find matching attendance document
        const matchAtt = attendance.find(a => a.customerId === deleteLedgerEntry.customerId && a.date === deleteLedgerEntry.date);
        if (matchAtt) {
          // Delete booking to free bed
          const matchBooking = bookings.find(
            (b) => b.customerId === deleteLedgerEntry.customerId && b.date === deleteLedgerEntry.date && b.bedNumber === matchAtt.bedNumber
          );
          if (matchBooking) {
            await deleteDoc(doc(db, "bookings", matchBooking.id));
          }

          // Update attendance status to absent
          await setDoc(doc(db, "attendance", matchAtt.id), {
            status: "absent",
            chargeLedgerId: null
          }, { merge: true });
        }
      }

      // If it was a waiver credit, regenerate the bookings for those dates!
      if (deleteLedgerEntry.kind === "day_waiver_credit" && deleteLedgerEntry.subscriptionId) {
        // Extract dates from note, e.g. "Rinuncia 15/07 - 24/07"
        // Let's retrieve the subscription and check which bookings are missing
        const sub = subscriptions.find(s => s.id === deleteLedgerEntry.subscriptionId);
        if (sub) {
          const subDates = getDatesInRange(sub.startDate, sub.endDate);
          const customer = customers.find(c => c.id === sub.customerId);
          
          if (customer) {
            for (const dt of subDates) {
              // Check if booking already exists on this bed
              const exists = bookings.some(b => b.subscriptionId === sub.id && b.date === dt);
              if (!exists) {
                // Perform a conflict check first
                const conflicts = checkConflictsForBeds(sub.bedNumbers, dt, dt, sub.slot);
                if (conflicts.length === 0) {
                  for (const bNum of sub.bedNumbers) {
                    await createBookingTransactional({
                      customerName: customer.name,
                      customerPhone: customer.phone || "",
                      customerType: "subscriber",
                      bedNumber: bNum,
                      date: dt,
                      slot: sub.slot,
                      source: "subscription",
                      subscriptionId: sub.id,
                      customerId: customer.id,
                      isConfirmedPayPerDay: customer.dealType === "pay_per_day" ? false : true,
                      dealType: customer.dealType
                    });
                  }
                } else {
                  // show inline conflict warn
                  setErrorMessage(`Alcune date della rinuncia annullata non sono state rigenerate perché l'ombrellone era già occupato da altri.`);
                }
              }
            }
          }
        }
      }

      setShowDeleteLedgerModal(false);
      setDeleteLedgerEntry(null);
      setAlsoMarkAbsent(false);
      setSuccessMessage("Movimento eliminato correttamente.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore eliminazione movimento: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Modify ledger entry
  const handleEditLedgerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLedgerEntry?.id) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      await setDoc(doc(db, "ledger", editLedgerEntry.id), {
        amount: Number(editLedgerAmount),
        method: editLedgerEntry.kind !== "adjustment" ? editLedgerMethod : null,
        date: editLedgerDate,
        note: editLedgerNote.trim() || null
      }, { merge: true });

      setShowEditLedgerModal(false);
      setEditLedgerEntry(null);
      setSuccessMessage("Movimento aggiornato.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore modifica movimento: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Modify Customer Notes
  const handleSaveCustomerNotes = async () => {
    if (!selectedCustomerId) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "customers", selectedCustomerId), {
        notes: editNotesText.trim() || null
      }, { merge: true });
      setIsEditingNotes(false);
      setSuccessMessage("Note salvate!");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore salvataggio note: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Save Customer Phone
  const handleSaveCustomerPhone = async (phone: string) => {
    if (!selectedCustomerId) return;
    try {
      await setDoc(doc(db, "customers", selectedCustomerId), {
        phone: phone.trim() || null
      }, { merge: true });
    } catch (err: any) {
      console.error(err);
    }
  };

  // Type B - Confirmation (Present/Absent today/on specific day)
  const handleMarkBAttendance = async (
    customerId: string,
    date: string,
    bedNumber: number,
    slot: BookingSlot,
    status: "present" | "absent",
    customDailyPrice = 15,
    tipoGiornata: "intera" | "mezza" = "intera"
  ) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const attendanceId = `${date}_${customerId}_${bedNumber}`;
      const attRef = doc(db, "attendance", attendanceId);
      const chargeId = `charge_${date}_${customerId}_${bedNumber}`;

      // Run transactional writes
      await runTransaction(db, async (tx) => {
        // Read setup config for mezza giornata price
        const setupSnap = await tx.get(doc(db, "config", "subscriptionSetup"));
        let prezzoMezzaCents: number | null = null;
        if (setupSnap.exists()) {
          prezzoMezzaCents = setupSnap.data()?.prezzoMezzaGiornata ?? null;
        }

        if (status === "present") {
          // Verify price config exists if "mezza" is requested
          if (tipoGiornata === "mezza") {
            if (prezzoMezzaCents === null || prezzoMezzaCents === undefined) {
              throw new Error("Il prezzo per la mezza giornata non è configurato. Configuralo prima di registrare una presenza a mezza giornata.");
            }
          }

          const resolvedPrice = tipoGiornata === "mezza" 
            ? prezzoMezzaCents! / 100 
            : customDailyPrice;

          // 1. Confirm booking
          const matchBooking = bookings.find(b => b.customerId === customerId && b.date === date && b.bedNumber === bedNumber);
          if (matchBooking) {
            tx.update(doc(db, "bookings", matchBooking.id), {
              isConfirmedPayPerDay: true
            });
          } else {
            // Generate booking transactional if missing
            const customer = customers.find(c => c.id === customerId);
            if (customer) {
              const bookingRef = doc(collection(db, "bookings"));
              tx.set(bookingRef, sanitizeForFirestore({
                customerName: customer.name,
                customerPhone: customer.phone || "",
                customerType: "subscriber",
                bedNumber,
                date,
                slot,
                source: "subscription",
                subscriptionId: "",
                customerId,
                isConfirmedPayPerDay: true,
                dealType: "pay_per_day",
                createdAt: new Date().toISOString()
              }));
            }
          }

          // 2. Write Ledger daily_charge entry
          tx.set(doc(db, "ledger", chargeId), sanitizeForFirestore({
            customerId,
            kind: "daily_charge",
            amount: resolvedPrice,
            date,
            note: `Presenza ${formatItalianDate(date)} - Ombrellone ${bedNumber} (${tipoGiornata === "mezza" ? "Mezza giornata" : "Giornata intera"})`,
            createdAt: new Date().toISOString()
          }));

          // 3. Mark Attendance
          tx.set(attRef, sanitizeForFirestore({
            id: attendanceId,
            customerId,
            bedNumber,
            date,
            slot,
            status: "present",
            tipoGiornata,
            chargeLedgerId: chargeId
          }));
        } else {
          // status === "absent"
          // 1. Delete booking
          const matchBooking = bookings.find(b => b.customerId === customerId && b.date === date && b.bedNumber === bedNumber);
          if (matchBooking) {
            tx.delete(doc(db, "bookings", matchBooking.id));
          }

          // 2. Delete daily_charge
          tx.delete(doc(db, "ledger", chargeId));

          // 3. Save Attendance as absent
          tx.set(attRef, sanitizeForFirestore({
            id: attendanceId,
            customerId,
            bedNumber,
            date,
            slot,
            status: "absent",
            tipoGiornata: "intera"
          }));
        }
      });

      setSuccessMessage("Presenza salvata.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore registrazione presenza: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateAttendanceTipo = async (
    customerId: string,
    date: string,
    bedNumber: number,
    slot: BookingSlot,
    tipoGiornata: "intera" | "mezza",
    customDailyPrice = 15
  ) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const attendanceId = `${date}_${customerId}_${bedNumber}`;
      const attRef = doc(db, "attendance", attendanceId);
      const chargeId = `charge_${date}_${customerId}_${bedNumber}`;

      await runTransaction(db, async (tx) => {
        // Read setup config for mezza giornata price
        const setupSnap = await tx.get(doc(db, "config", "subscriptionSetup"));
        let prezzoMezzaCents: number | null = null;
        if (setupSnap.exists()) {
          prezzoMezzaCents = setupSnap.data()?.prezzoMezzaGiornata ?? null;
        }

        if (tipoGiornata === "mezza") {
          if (prezzoMezzaCents === null || prezzoMezzaCents === undefined) {
            throw new Error("Il prezzo per la mezza giornata non è configurato. Configuralo prima di impostare la mezza giornata.");
          }
        }

        const resolvedPrice = tipoGiornata === "mezza" 
          ? prezzoMezzaCents! / 100 
          : customDailyPrice;

        // Update ledger entry
        tx.set(doc(db, "ledger", chargeId), sanitizeForFirestore({
          customerId,
          kind: "daily_charge",
          amount: resolvedPrice,
          date,
          note: `Presenza ${formatItalianDate(date)} - Ombrellone ${bedNumber} (${tipoGiornata === "mezza" ? "Mezza giornata" : "Giornata intera"})`,
          createdAt: new Date().toISOString()
        }));

        // Update attendance doc
        tx.set(attRef, sanitizeForFirestore({
          id: attendanceId,
          customerId,
          bedNumber,
          date,
          slot,
          status: "present",
          tipoGiornata,
          chargeLedgerId: chargeId
        }));
      });

      setSuccessMessage("Tipo giornata modificato con successo.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore modifica tipo giornata: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Reconciliation handlers (Part C)
  const handleReconcileManually = async (dpId: string, subId: string) => {
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const dpRef = doc(db, "dailyPresences", dpId);
      await setDoc(dpRef, {
        matchStatus: "matched",
        matchedSubscriptionId: subId,
        matchedCustomerId: selectedCustomerId
      }, { merge: true });
      setSuccessMessage("Presenza riconciliata con successo!");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage("Errore durante la riconciliazione: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAbsent = async (dateStr: string, bedNum: number, slot: string, subId: string) => {
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const platform = bedNum <= 34 ? "sx" : "dx";
      const normSlot = slot === "full_day" ? "both" : slot;
      const presenceId = `${dateStr}_${platform}_${bedNum}_${normSlot}`;
      
      const dpRef = doc(db, "dailyPresences", presenceId);
      await setDoc(dpRef, {
        platform,
        bedNumber: bedNum,
        date: dateStr,
        slot: normSlot,
        rawName: "ASSENTE_CONFIGURATO",
        parseConfidence: "clean",
        importedAt: new Date().toISOString(),
        matchStatus: "matched",
        matchedSubscriptionId: subId,
        matchedCustomerId: selectedCustomerId
      });
      setSuccessMessage("Giornata segnata come assenza con successo!");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage("Errore nell'impostare l'assenza: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAbsent = async (dpId: string) => {
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteDoc(doc(db, "dailyPresences", dpId));
      setSuccessMessage("Assenza rimossa con successo!");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage("Errore nella rimozione dell'assenza: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // JSON Import execution
  const handleBulkImport = async () => {
    if (!jsonText.trim()) return;
    setSaving(true);
    setImportStatus("Importazione in corso...");

    try {
      const arr = JSON.parse(jsonText);
      if (!Array.isArray(arr)) {
        throw new Error("Il JSON deve essere un array di oggetti");
      }

      let count = 0;
      for (const item of arr) {
        if (!item.name) continue;

        const dealType = (item.dealType || item.tipo_accordo || "seasonal") === "pay_per_day" ? "pay_per_day" : "seasonal";

        const customerRef = doc(collection(db, "customers"));
        await setDoc(customerRef, sanitizeForFirestore({
          name: item.name.trim(),
          phone: item.phone ? String(item.phone).trim() : null,
          notes: item.notes ? String(item.notes).trim() : null,
          dealType,
          type: "subscriber",
          createdAt: new Date().toISOString()
        }));
        count++;
      }

      setImportStatus(`Importati con successo ${count} clienti.`);
      setJsonText("");
      setTimeout(() => {
        setShowImportModal(false);
        setImportStatus(null);
      }, 3000);
    } catch (err: any) {
      setImportStatus("Errore durante l'importazione: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Cascade delete single customer
  const handleDeleteCustomerCascade = async () => {
    if (!selectedCustomerId) return;
    setSaving(true);
    setErrorMessage(null);

    try {
      const custId = selectedCustomerId;

      // 1. Find all subscriptions
      const custSubs = subscriptions.filter(s => s.customerId === custId);
      const custSubIds = custSubs.map(s => s.id).filter(Boolean) as string[];

      // 2. Find all ledger entries
      const custLedger = ledger.filter(l => l.customerId === custId);

      // 3. Find all attendance logs
      const custAttendance = attendance.filter(a => a.customerId === custId);

      // 4. Find all bookings
      const custBookings = bookings.filter(b => 
        b.customerId === custId || 
        (b.subscriptionId && custSubIds.includes(b.subscriptionId))
      );

      // Delete customer document
      await deleteDoc(doc(db, "customers", custId));

      // Delete subscriptions
      for (const s of custSubs) {
        if (s.id) await deleteDoc(doc(db, "subscriptions", s.id));
      }

      // Delete ledger entries
      for (const l of custLedger) {
        if (l.id) await deleteDoc(doc(db, "ledger", l.id));
      }

      // Delete attendance logs
      for (const a of custAttendance) {
        if (a.id) await deleteDoc(doc(db, "attendance", a.id));
      }

      // Delete bookings
      for (const b of custBookings) {
        if (b.id) await deleteDoc(doc(db, "bookings", b.id));
      }

      setShowDeleteCustomerModal(false);
      setSelectedCustomerId(null);
      setSuccessMessage("Cliente ed elementi associati eliminati con successo.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante l'eliminazione a cascata: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Bulk cleanup of no-subscription customers
  const handleDeleteAllCustomersNoSubs = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const targets = customers.filter(cust => !subscriptions.some(s => s.customerId === cust.id));
      
      for (const cust of targets) {
        const custId = cust.id!;
        
        // Delete customer
        await deleteDoc(doc(db, "customers", custId));

        // Delete ledger entries if any
        const custLedger = ledger.filter(l => l.customerId === custId);
        for (const l of custLedger) {
          if (l.id) await deleteDoc(doc(db, "ledger", l.id));
        }

        // Delete attendance logs if any
        const custAttendance = attendance.filter(a => a.customerId === custId);
        for (const a of custAttendance) {
          if (a.id) await deleteDoc(doc(db, "attendance", a.id));
        }

        // Delete bookings if any
        const custBookings = bookings.filter(b => b.customerId === custId);
        for (const b of custBookings) {
          if (b.id) await deleteDoc(doc(db, "bookings", b.id));
        }
      }

      setShowDeleteAllNoSubsModal(false);
      setSelectedCustomerId(null);
      setSuccessMessage(`Eliminati con successo ${targets.length} clienti senza abbonamenti.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante la pulizia dei clienti: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const isCustomerSpurious = (cust: Customer) => {
    if (!cust.id) return false;
    const hasSub = subscriptions.some(s => s.customerId === cust.id);
    const hasLedger = ledger.some(l => l.customerId === cust.id);
    const hasValidDealType = cust.dealType === "seasonal" || cust.dealType === "pay_per_day" || (cust.dealType as string) === "hotel";
    return !hasSub && !hasLedger && !hasValidDealType;
  };

  const handleDeleteAllSpurious = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      const targets = customers.filter(isCustomerSpurious);
      
      for (const cust of targets) {
        if (cust.id) {
          await deleteDoc(doc(db, "customers", cust.id));
        }
      }

      setShowDeleteAllSpuriousModal(false);
      setSelectedCustomerId(null);
      setSuccessMessage(`Eliminate con successo ${targets.length} anagrafiche spurie.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage("Errore durante la pulizia dei clienti spurii: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Filtered customer list
  const filteredCustomers = customers.filter((cust) => {
    const hasSub = subscriptions.some(s => s.customerId === cust.id);
    const hasValidDealType = cust.dealType === "seasonal" || cust.dealType === "pay_per_day" || (cust.dealType as string) === "hotel";
    if (!hasSub && !hasValidDealType) {
      return false; // strictly exclude "nudi" / spurious or non-abbonato customers
    }

    const matchesSearch = cust.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (cust.phone && cust.phone.includes(searchQuery)) ||
      subscriptions.some(s => s.customerId === cust.id && s.bedNumbers.some(b => String(b) === searchQuery));

    const matchesFilter = 
      dealTypeFilter === "all" || 
      (dealTypeFilter === "no_subscriptions" 
        ? !subscriptions.some(s => s.customerId === cust.id) 
        : dealTypeFilter === "only_spurious"
          ? isCustomerSpurious(cust)
          : cust.dealType === dealTypeFilter);

    return matchesSearch && matchesFilter;
  });

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      
      {/* Messages */}
      {errorMessage && (
        <div className="lg:col-span-12 bg-rose-50 border border-rose-100 p-4 rounded-2xl text-xs font-bold text-rose-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-600 font-bold">✕</button>
        </div>
      )}

      {successMessage && (
        <div className="lg:col-span-12 bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-xs font-bold text-emerald-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-600 font-bold">✕</button>
        </div>
      )}

      {/* LEFT COLUMN: CUSTOMERS LIST (SPAN 5) */}
      <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4">
        
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-[#025A70]" />
            <span>Anagrafica Clienti Abbonati</span>
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              id="btn-import-json-modal"
              onClick={() => setShowImportModal(true)}
              className="p-1.5 text-slate-500 hover:text-[#025A70] hover:bg-slate-50 rounded-xl transition-all border border-slate-100 cursor-pointer"
              title="Importa da JSON"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
            <button
              id="btn-bulk-import-modal"
              onClick={() => setShowBulkImportModal(true)}
              className="px-2 py-1.5 bg-[#025A70] hover:bg-[#014152] text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
              title="Importa elenco abbonati"
            >
              <Users className="w-4 h-4" />
              <span>Importa elenco abbonati</span>
            </button>
            <button
              id="btn-print-subscribers-modal"
              onClick={() => setShowPrintModal(true)}
              className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
              title="Stampa elenco abbonati"
            >
              <Printer className="w-4 h-4" />
              <span>Stampa</span>
            </button>
            <button
              id="btn-sub-setup-tab"
              onClick={() => {
                setActiveTab(activeTab === "setup" ? "list" : "setup");
              }}
              className={`px-2 py-1.5 text-xs font-extrabold rounded-xl transition-all flex items-center gap-1 border cursor-pointer ${
                activeTab === "setup"
                  ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-sm"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
              }`}
              title="Setup Periodi, Tipologie, Listino"
            >
              <Settings className="w-4 h-4 animate-spin-hover" />
              <span>Setup</span>
            </button>
            <button
              id="btn-sub-bonifica-orphans"
              onClick={handleSearchOrphanBookings}
              disabled={loadingOrphans}
              className="px-2 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
              title="Bonifica prenotazioni orfane"
            >
              <AlertCircle className={`w-4 h-4 ${loadingOrphans ? "animate-spin" : ""}`} />
              <span>{loadingOrphans ? "Verifica..." : "Bonifica orfane"}</span>
            </button>
            <button
              id="btn-sub-new-tab"
              onClick={() => {
                setNewCustName("");
                setNewCustPhone("");
                setNewCustNotes("");
                setActiveTab(activeTab === "list" ? "new" : "list");
              }}
              className="px-2 py-1.5 bg-[#025A70] hover:bg-[#014152] text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
            >
              {activeTab === "list" ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Nuovo</span>
                </>
              ) : (
                <>
                  <ArrowLeft className="w-4 h-4" />
                  <span>Elenco</span>
                </>
              )}
            </button>
          </div>
        </div>

        {activeTab === "list" ? (
          <>
            {/* Search and filter controls */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="sub-search-input"
                  type="text"
                  placeholder="Cerca per nome, telefono o lettino..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 transition-all focus:outline-none"
                />
              </div>

              <select
                id="filter-deal-type"
                value={dealTypeFilter}
                onChange={(e) => setDealTypeFilter(e.target.value as any)}
                className="px-2 py-1.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-semibold text-slate-600 focus:outline-none"
              >
                <option value="all">Tutti gli accordi</option>
                <option value="seasonal">Stagionali (A)</option>
                <option value="pay_per_day">Giornalieri (B)</option>
                <option value="no_subscriptions">Senza abbonamenti</option>
                <option value="only_spurious">Solo spurie (senza abbonamenti né conto)</option>
              </select>
            </div>

            {dealTypeFilter === "no_subscriptions" && (
              <div className="bg-rose-50 border border-rose-100 p-3.5 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider block">Pulizia Anagrafica Spuria</span>
                  <span className="text-xs text-rose-600 font-extrabold block">
                    {customers.filter(cust => !subscriptions.some(s => s.customerId === cust.id)).length} clienti senza abbonamenti.
                  </span>
                </div>
                {customers.filter(cust => !subscriptions.some(s => s.customerId === cust.id)).length > 0 && (
                  <button
                    id="btn-bulk-delete-no-subs"
                    onClick={() => setShowDeleteAllNoSubsModal(true)}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black rounded-lg shadow-sm transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Elimina Tutti</span>
                  </button>
                )}
              </div>
            )}

            {dealTypeFilter === "only_spurious" && (
              <div className="bg-rose-50 border border-rose-100 p-3.5 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider block">Solo spurie (senza abbonamenti né conto)</span>
                  <span className="text-xs text-rose-600 font-extrabold block">
                    {customers.filter(isCustomerSpurious).length} clienti spurii trovati.
                  </span>
                </div>
                {customers.filter(isCustomerSpurious).length > 0 && (
                  <button
                    id="btn-bulk-delete-spurious"
                    onClick={() => setShowDeleteAllSpuriousModal(true)}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Elimina tutte le spurie</span>
                  </button>
                )}
              </div>
            )}

            {/* Customers grid list */}
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((cust) => {
                  const isSelected = selectedCustomerId === cust.id;
                  const { residuo } = getCustomerFinances(cust.id!);
                  
                  // Active sub items for this customer
                  const custSubs = subscriptions.filter(s => s.customerId === cust.id && s.status === "active");
                  const activeBeds = Array.from(new Set(custSubs.flatMap(s => s.bedNumbers))).sort((a,b)=>a-b);
                  const activePeriod = custSubs.length > 0 
                    ? `${custSubs[0].startDate} / ${custSubs[custSubs.length-1].endDate}`
                    : "Nessun periodo";

                  return (
                    <div
                      key={cust.id}
                      id={`customer-card-${cust.id}`}
                      onClick={() => {
                        setSelectedCustomerId(cust.id!);
                        setEditNotesText(cust.notes || "");
                        setIsEditingNotes(false);
                      }}
                      className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected 
                          ? "bg-blue-50/50 border-blue-200 shadow-sm" 
                          : "bg-white border-slate-100 hover:border-slate-200"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-xs text-slate-800 truncate block">
                            {cust.name}
                          </span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md ${
                            cust.dealType === "pay_per_day" 
                              ? "bg-purple-100 text-purple-700 border border-purple-200" 
                              : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                          }`}>
                            {cust.dealType === "pay_per_day" ? "Tipo B" : "Tipo A"}
                          </span>
                          {custSubs.some(s => s.priceMode === "da_concordare") && (
                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200 animate-pulse shrink-0">
                              DA CONCORDARE
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold">
                          {cust.phone && (
                            <span className="flex items-center gap-1 shrink-0">
                              <Phone className="w-3 h-3 text-slate-300" />
                              {cust.phone}
                            </span>
                          )}
                          <span className="truncate">
                            Ombrelloni: {activeBeds.length > 0 ? activeBeds.join(", ") : "Nessuno"}
                          </span>
                        </div>

                        <div className="text-[9px] text-slate-400">
                          {activePeriod}
                        </div>
                      </div>

                      {/* Residuo Status Badge */}
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-black px-2 py-1 rounded-lg ${
                          residuo <= 0 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                            : custLedgerHasPayments(cust.id!, ledger)
                              ? "bg-amber-50 text-amber-700 border border-amber-100"
                              : "bg-rose-50 text-rose-700 border border-rose-100"
                        }`}>
                          {residuo <= 0 ? (
                            <span className="flex items-center gap-1 text-[10px]">
                              <Check className="w-3 h-3 text-emerald-600" />
                              Saldato
                            </span>
                          ) : (
                            <span className="text-[10px]">
                              {residuo}€
                            </span>
                          )}
                        </div>
                        <span className="text-[8px] font-bold text-slate-400 block mt-1 uppercase tracking-wider">Residuo</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-10 text-xs text-slate-400">
                  Nessun cliente trovato con i filtri attuali.
                </div>
              )}
            </div>
          </>
        ) : (
          /* NEW CUSTOMER FORM */
          <form onSubmit={handleCreateCustomer} className="space-y-4 pt-2">
            <h3 className="text-xs font-bold text-[#025A70] uppercase tracking-wider">Nuova Anagrafica Cliente</h3>
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Nome e Cognome *</label>
              <input
                id="input-new-cust-name"
                type="text"
                required
                placeholder="es. Mario Rossi"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Telefono</label>
                <input
                  id="input-new-cust-phone"
                  type="text"
                  placeholder="es. 333123456"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Tipo Accordo *</label>
                <select
                  id="select-new-cust-deal"
                  value={newCustDealType}
                  onChange={(e) => setNewCustDealType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:outline-none"
                >
                  <option value="seasonal">Stagionale (A) - Prezzo fisso</option>
                  <option value="pay_per_day">Giornaliero (B) - Paga se presente</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Note Cliente</label>
              <textarea
                id="textarea-new-cust-notes"
                rows={3}
                placeholder="es. Preferisce prima fila, parente di..."
                value={newCustNotes}
                onChange={(e) => setNewCustNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all resize-none"
              />
            </div>

            <button
              id="btn-submit-new-cust"
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
            >
              {saving ? "Salvataggio..." : "Salva Anagrafica Cliente"}
            </button>
          </form>
        )}
      </div>

      {/* RIGHT COLUMN: WORKSPACE CARD (SPAN 7) */}
      <div className="lg:col-span-7 space-y-6">
        
        {activeTab === "setup" ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-6">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <span className="text-[10px] font-black text-amber-600 uppercase tracking-wider">Pannello Configurazione</span>
                <h3 className="text-lg font-black text-slate-800">Setup Abbonamenti</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("list")}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Torna all'Elenco</span>
              </button>
            </div>

            {/* 1. SETUP PERIODI & TIPOLOGIE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* SEZIONE PERIODI */}
              <div className="space-y-4 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
                <div className="flex justify-between items-center">
                  <h4 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">1. Periodi</h4>
                  <span className="text-[10px] font-bold text-slate-400">Configurazione date stagionali</span>
                </div>

                {/* Form Nuovo Periodo */}
                <form
                  onSubmit={handleCreatePeriod}
                  className="bg-white p-3 border border-slate-200/60 rounded-xl space-y-2.5 shadow-sm"
                >
                  <span className="text-[9px] font-black text-slate-500 uppercase block">Nuovo Periodo</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Codice ID (es. giugno-luglio)"
                      value={addPeriodId}
                      onChange={(e) => setAddPeriodId(e.target.value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, ""))}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Nome Visibile (es. Giugno + Luglio)"
                      value={addPeriodLabel}
                      onChange={(e) => setAddPeriodLabel(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                    <input
                      type="date"
                      required
                      value={addPeriodStart}
                      onChange={(e) => setAddPeriodStart(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                    <input
                      type="date"
                      required
                      value={addPeriodEnd}
                      onChange={(e) => setAddPeriodEnd(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-lg transition-all cursor-pointer"
                  >
                    Aggiungi Periodo
                  </button>
                </form>

                {/* Lista Periodi */}
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {(subscriptionSetup?.periods || []).map((p: any) => (
                    <div
                      key={p.id}
                      className={`p-3 bg-white border rounded-xl flex items-center justify-between gap-2 shadow-sm ${
                        !p.active ? "opacity-50 border-slate-100" : "border-slate-200"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-800 font-extrabold text-xs">{p.label}</span>
                          <span className="text-[8px] font-bold text-slate-400 bg-slate-100 px-1 rounded uppercase tracking-wider">{p.id}</span>
                        </div>
                        <span className="font-semibold text-[10px] text-slate-500 block">
                          dal {p.dateStart} al {p.dateEnd}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {p.active ? (
                          <button
                            type="button"
                            onClick={() => handleDeletePeriod(p.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                            title="Disattiva"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTogglePeriodActive(p.id, true)}
                            className="p-1 text-emerald-500 hover:text-emerald-600 rounded-lg cursor-pointer"
                            title="Riattiva"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SEZIONE TIPOLOGIE OMBRELLONI */}
              <div className="space-y-4 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
                <div className="flex justify-between items-center">
                  <h4 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">2. Tipologie Postazione</h4>
                  <span className="text-[10px] font-bold text-slate-400">Classi di listino ombrelloni</span>
                </div>

                {/* Form Nuova Tipologia */}
                <form
                  onSubmit={handleCreateSlotType}
                  className="bg-white p-3 border border-slate-200/60 rounded-xl space-y-2.5 shadow-sm"
                >
                  <span className="text-[9px] font-black text-slate-500 uppercase block">Nuova Tipologia</span>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="ID (es. 1lig)"
                      value={addSlotTypeId}
                      onChange={(e) => setAddSlotTypeId(e.target.value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, ""))}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Sigla (es. 1LIG)"
                      value={addSlotTypeCode}
                      onChange={(e) => setAddSlotTypeCode(e.target.value.toUpperCase().trim())}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Descrizione (es. 1 Lettino)"
                      value={addSlotTypeLabel}
                      onChange={(e) => setAddSlotTypeLabel(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-lg transition-all cursor-pointer"
                  >
                    Aggiungi Tipologia
                  </button>
                </form>

                {/* Lista Tipologie */}
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {(subscriptionSetup?.slotTypes || []).map((st: any) => (
                    <div
                      key={st.id}
                      className={`p-3 bg-white border rounded-xl flex items-center justify-between gap-2 shadow-sm ${
                        !st.active ? "opacity-50 border-slate-100" : "border-slate-200"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="bg-slate-100 text-slate-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase">
                            {st.code}
                          </span>
                          <span className="font-extrabold text-xs text-slate-800">
                            {st.label}
                          </span>
                          <span className="text-[8px] font-bold text-slate-400">({st.id})</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {st.active ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteSlotType(st.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                            title="Disattiva"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleSlotTypeActive(st.id, true)}
                            className="p-1 text-emerald-500 hover:text-emerald-600 rounded-lg cursor-pointer"
                            title="Riattiva"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* CONFIGURAZIONE PREZZO MEZZA GIORNATA */}
            <div className="space-y-4 bg-slate-50/50 p-5 border border-slate-100 rounded-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/40 pb-3">
                <div className="space-y-1">
                  <h4 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">Configurazione Prezzo Mezza Giornata</h4>
                  <p className="text-[10px] text-slate-500 font-semibold">
                    Inserisci il prezzo per la mezza giornata in centesimi (es. 1000 per 10,00 €). Se non configurato, la registrazione presenze a mezza giornata non sarà permessa.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveHalfDayPrice}
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer self-start sm:self-center"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "Salvataggio..." : "Salva Prezzo"}</span>
                </button>
              </div>

              <div className="bg-white p-4 border border-slate-200/60 rounded-xl space-y-3 max-w-sm shadow-sm">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Prezzo Mezza Giornata (centesimi) *</label>
                  <div className="relative">
                    <input
                      id="input-config-half-day-price"
                      type="number"
                      placeholder="es. 1000"
                      value={configHalfDayPrice}
                      onChange={(e) => setConfigHalfDayPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-[#025A70]/20 transition-all outline-hidden"
                    />
                    <span className="absolute right-2.5 top-2 text-[10px] font-black text-slate-400">cents</span>
                  </div>
                  {configHalfDayPrice !== "" && (
                    <span className="text-[10px] text-emerald-600 block font-semibold mt-1">
                      Equivale a: {(Number(configHalfDayPrice) / 100).toFixed(2)} €
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 2. LISTINO PREZZI MATRIX GRID */}
            <div className="space-y-4 bg-slate-50/50 p-5 border border-slate-100 rounded-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/40 pb-3">
                <div className="space-y-1">
                  <h4 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">3. Listino Prezzi Corrente</h4>
                  <p className="text-[10px] text-slate-500 font-semibold">
                    Compila gli incroci Periodo x Tipologia. I prezzi a listino verranno aggiornati in tempo reale per tutti gli abbonati associati!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSavePriceList}
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer self-start sm:self-center"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "Salvataggio..." : "Salva Listino"}</span>
                </button>
              </div>

              {/* Grid Matrix Table */}
              <div className="overflow-x-auto border border-slate-200/50 rounded-xl bg-white shadow-inner">
                <table className="w-full text-xs text-left text-slate-500">
                  <thead className="text-[10px] uppercase font-bold text-slate-400 bg-slate-50/50 border-b border-slate-200/60">
                    <tr>
                      <th scope="col" className="px-4 py-3 min-w-[150px]">Periodo / Tipologia</th>
                      {(subscriptionSetup?.slotTypes || []).filter((st: any) => st.active).map((st: any) => (
                        <th key={st.id} scope="col" className="px-4 py-3 text-center min-w-[120px]">
                          <div className="space-y-0.5">
                            <span className="text-slate-800 font-extrabold block">{st.label}</span>
                            <span className="text-[8px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded inline-block uppercase tracking-wider">{st.code}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(subscriptionSetup?.periods || []).filter((p: any) => p.active).map((p: any) => (
                      <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/30 transition-all">
                        <td className="px-4 py-3 font-extrabold text-slate-700">
                          <div className="space-y-0.5">
                            <span>{p.label}</span>
                            <span className="font-semibold text-[9px] text-slate-400 block">dal {p.dateStart} al {p.dateEnd}</span>
                          </div>
                        </td>
                        {(subscriptionSetup?.slotTypes || []).filter((st: any) => st.active).map((st: any) => {
                          const value = gridPrices[`${p.id}_${st.id}`] ?? "";
                          return (
                            <td key={st.id} className="px-4 py-3 text-center">
                              <div className="relative inline-block w-24">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="Nessuno"
                                  value={value}
                                  onChange={(e) => {
                                    const val = e.target.value === "" ? "" : Number(e.target.value);
                                    setGridPrices(prev => ({
                                      ...prev,
                                      [`${p.id}_${st.id}`]: val
                                    }));
                                  }}
                                  className="w-full text-center px-2 py-1.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-lg text-xs font-bold text-slate-700 transition-all"
                                />
                                <span className="absolute right-2.5 top-1.5 text-slate-400 font-bold pointer-events-none">€</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                    {/* Empty fallback row */}
                    {((subscriptionSetup?.periods || []).filter((p: any) => p.active).length === 0 ||
                      (subscriptionSetup?.slotTypes || []).filter((st: any) => st.active).length === 0) && (
                      <tr>
                        <td colSpan={100} className="px-4 py-8 text-center text-slate-400 font-semibold">
                          Nessun periodo o tipologia attiva. Aggiungine almeno uno sopra per compilare il listino.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        ) : selectedCustomer ? (
          <div id="customer-detail-workspace" className="space-y-6">
            
            {/* 1. TESTATA DETTAGLIO */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Scheda Cliente</span>
                  <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    {selectedCustomer.name}
                    <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border ${
                      selectedCustomer.dealType === "pay_per_day"
                        ? "bg-purple-50 text-purple-700 border-purple-100"
                        : "bg-emerald-50 text-emerald-700 border-emerald-100"
                    }`}>
                      {selectedCustomer.dealType === "pay_per_day" ? "Accordo Tipo B (Giornaliero)" : "Accordo Tipo A (Stagionale)"}
                    </span>
                  </h3>
                  
                  {/* Phone editable inline */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 px-1 py-0.5 focus:outline-none font-semibold text-slate-600 focus:bg-white rounded transition-all"
                      defaultValue={selectedCustomer.phone || ""}
                      placeholder="Nessun telefono (Clicca per inserire)"
                      onBlur={(e) => handleSaveCustomerPhone(e.target.value)}
                    />
                  </div>
                </div>

                {/* Big colored Residuo Indicator */}
                {(() => {
                  const { dovuto, versato, crediti, residuo } = getCustomerFinances(selectedCustomer.id!);
                  return (
                    <div className="text-right flex items-center gap-3 sm:flex-col sm:items-end">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Conto Unico Cliente</span>
                        <span className={`text-2xl font-black ${
                          residuo <= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}>
                          {residuo}€
                        </span>
                      </div>
                      <button
                        id="btn-delete-customer-init"
                        type="button"
                        onClick={() => setShowDeleteCustomerModal(true)}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 border border-rose-100 hover:border-rose-200 text-[10px] font-black rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                        title="Elimina Cliente"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Elimina Cliente</span>
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Note Cliente editable */}
              <div className="space-y-1 bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 text-xs">
                <span className="font-extrabold text-slate-400 uppercase tracking-wider text-[9px] block mb-1">Note sull'Anagrafica</span>
                {isEditingNotes ? (
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold resize-none"
                      value={editNotesText}
                      onChange={(e) => setEditNotesText(e.target.value)}
                    />
                    <button
                      onClick={handleSaveCustomerNotes}
                      disabled={saving}
                      className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg self-end flex items-center justify-center cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-4">
                    <p className="text-slate-600 font-medium italic">
                      {selectedCustomer.notes || "Nessuna nota registrata sul cliente."}
                    </p>
                    <button
                      onClick={() => {
                        setEditNotesText(selectedCustomer.notes || "");
                        setIsEditingNotes(true);
                      }}
                      className="text-[10px] text-blue-600 font-bold hover:underline"
                    >
                      Modifica note
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 2. STATO ECONOMICO & CONTO FORM */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider block">Stato Economico & Formula Residuo</h4>
              
              {(() => {
                const { dovuto, versato, crediti, residuo } = getCustomerFinances(selectedCustomer.id!);
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-[9px] text-slate-400 font-bold uppercase block">Dovuto (Totale)</span>
                        <span className="text-sm font-black text-slate-700 block mt-1">{dovuto}€</span>
                      </div>
                      <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                        <span className="text-[9px] text-emerald-600 font-bold uppercase block">Versato</span>
                        <span className="text-sm font-black text-emerald-800 block mt-1">+{versato}€</span>
                      </div>
                      <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                        <span className="text-[9px] text-blue-600 font-bold uppercase block">Crediti/Defalchi</span>
                        <span className="text-sm font-black text-blue-800 block mt-1">+{crediti}€</span>
                      </div>
                      <div className={`p-3 rounded-xl border ${
                        residuo <= 0 ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"
                      }`}>
                        <span className="text-[9px] font-bold uppercase block">Residuo</span>
                        <span className="text-sm font-black block mt-1">{residuo}€</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 bg-slate-50 p-2.5 rounded-lg font-mono flex items-center justify-center gap-1">
                      <Info className="w-3.5 h-3.5 text-slate-300" />
                      <span>Formula: {dovuto}€ (Dovuto) − {versato}€ (Versato) − {crediti}€ (Crediti) = <strong>{residuo}€ (Residuo)</strong></span>
                    </div>

                    {/* Quick Payment Form */}
                    <form onSubmit={(e) => handleAddLedgerEntry(e, "payment")} className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-3">
                      <span className="text-[10px] font-black text-slate-500 uppercase block">Registra Nuovo Movimento / Acconto</span>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="relative">
                          <input
                            id="input-ledger-amount"
                            type="number"
                            required
                            placeholder="Importo (€)"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value === "" ? "" : Number(e.target.value))}
                            className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                          />
                          <span className="absolute left-2.5 top-1.5 text-xs text-slate-400">€</span>
                        </div>

                        <select
                          id="select-ledger-method"
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                          className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        >
                          <option value="cash">Contanti</option>
                          <option value="card">Carta/POS</option>
                        </select>

                        <input
                          id="input-ledger-note"
                          type="text"
                          placeholder="Note (es. Acconto Luglio)"
                          value={payNote}
                          onChange={(e) => setPayNote(e.target.value)}
                          className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleAddLedgerEntry(e, "deposit")}
                          disabled={saving || payAmount === ""}
                          className="px-3 py-1.5 bg-blue-50 border border-blue-100 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100"
                        >
                          Registra Caparra
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleAddLedgerEntry(e, "adjustment")}
                          disabled={saving || payAmount === ""}
                          className="px-3 py-1.5 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200"
                        >
                          Registra Storno/Storno
                        </button>
                        <button
                          type="submit"
                          disabled={saving || payAmount === ""}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm"
                        >
                          Registra Pagamento
                        </button>
                      </div>
                    </form>
                  </div>
                );
              })()}
            </div>

            {/* 3. LISTA ABBONAMENTI / PERIODI */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Abbonamenti / Periodi di Ombrellone</h4>
                <button
                  id="btn-open-add-period"
                  onClick={() => {
                    setNewPeriodBeds("");
                    setNewPeriodStartDate("");
                    setNewPeriodEndDate("");
                    setNewPeriodPrice(selectedCustomer.dealType === "pay_per_day" ? 0 : 300); // 0 by default for type B
                    setNewPeriodPricingRule("standard");
                    setNewPeriodWeekendRate(25);
                    setShowAddPeriodModal(true);
                  }}
                  className="px-3 py-1 bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 rounded-lg text-[10px] font-black flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Aggiungi periodo</span>
                </button>
              </div>

              {/* Periods List */}
              <div className="space-y-4">
                {subscriptions.filter((s) => s.customerId === selectedCustomerId).length > 0 ? (
                  subscriptions
                    .filter((s) => s.customerId === selectedCustomerId)
                    .map((sub) => {
                      const isActive = sub.status === "active";
                      
                      return (
                        <div
                          key={sub.id}
                          className={`p-4 rounded-xl border ${
                            isActive 
                              ? "bg-slate-50 border-slate-100" 
                              : "bg-slate-100 border-slate-200 text-slate-400 line-through opacity-70"
                          } space-y-3 relative`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 block uppercase">Periodo Ombrellone</span>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-sm text-slate-800">
                                  Ombrellon{sub.bedNumbers.length > 1 ? "i" : "o"}: <span className="font-mono text-blue-600">{sub.bedNumbers.join(", ")}</span>
                                </span>
                                <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                                  isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                                }`}>
                                  {isActive ? "Attivo" : "Disdetto"}
                                </span>
                                {sub.soloWeekend && (
                                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 shadow-2xs">
                                    Solo weekend
                                  </span>
                                )}
                              </div>
                            </div>

                            {selectedCustomer.dealType !== "pay_per_day" && (
                              <div className="text-right flex flex-col items-end">
                                <span className="text-[10px] font-bold text-slate-400 block uppercase">Prezzo Periodo</span>
                                {sub.priceMode === "da_concordare" ? (
                                  <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md uppercase tracking-wider animate-pulse mt-0.5 block">
                                    DA CONCORDARE
                                  </span>
                                ) : (
                                  <>
                                    <span className="font-black text-sm text-slate-800">
                                      {getSubscriptionEffectivePrice(sub)}€
                                    </span>
                                    <span className="text-[9px] font-bold text-slate-400">
                                      ({sub.priceMode === "concordato" ? "concordato" : "listino"})
                                    </span>
                                  </>
                                )}
                                {sub.pricingRule === "hotel_weekend" && (
                                  <span className="text-[9px] font-bold text-rose-600 block bg-rose-50 border border-rose-100/40 rounded px-1.5 py-0.5 mt-1 text-center">
                                    Hotel: feriali gratis, weekend €{sub.weekendRate}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-slate-500 border-t border-slate-200/50 pt-2.5">
                            <div>
                              <span className="text-[9px] text-slate-400 block">Fascia Oraria</span>
                              <span className="text-slate-700 capitalize">{sub.slot === "full_day" ? "Giornata Intera" : sub.slot === "morning" ? "Mattina" : "Pomeriggio"}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-slate-400 block">Intervallo Date</span>
                              <span className="text-slate-700 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                dal {sub.startDate} al {sub.endDate}
                              </span>
                            </div>
                          </div>

                          {/* Period Action Buttons */}
                          {isActive && (
                            <div className="flex justify-end gap-2 border-t border-slate-200/50 pt-3 flex-wrap">
                              
                              {/* Modifica Prezzo / Setup Button */}
                              {selectedCustomer.dealType !== "pay_per_day" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSubForEdit(sub);
                                    setEditSubPeriodId(sub.periodId || "");
                                    setEditSubSlotTypeId(sub.slotTypeId || "");
                                    setEditSubPriceMode(sub.priceMode || "listino");
                                    setEditSubAgreedPrice(sub.agreedPrice !== null && sub.agreedPrice !== undefined ? sub.agreedPrice : "");
                                    setShowEditSubPriceModal(true);
                                  }}
                                  className="px-2.5 py-1 text-[10px] bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-extrabold rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                                >
                                  <Edit className="w-3 h-3 text-slate-500" />
                                  <span>Modifica Prezzo</span>
                                </button>
                              )}

                              {/* Sposta Ombrellone Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setMoveSub(sub);
                                  setMoveNewBed("");
                                  setMoveEffectiveDate(getRomeTodayString() > sub.startDate ? getRomeTodayString() : sub.startDate);
                                  setShowMoveModal(true);
                                }}
                                className="px-2.5 py-1 text-[10px] bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-600 font-extrabold rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                              >
                                <Move className="w-3 h-3 text-slate-500" />
                                <span>Sposta Ombrellone</span>
                              </button>

                              {/* Rinuncia Giorni Button (Only seasonal Type A) */}
                              {selectedCustomer.dealType !== "pay_per_day" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWaiverSub(sub);
                                    setWaiverStart("");
                                    setWaiverEnd("");
                                    setWaiverCredit("");
                                    setShowWaiverModal(true);
                                  }}
                                  className="px-2.5 py-1 text-[10px] bg-blue-50 border border-blue-100 hover:bg-blue-100 text-blue-600 font-extrabold rounded-lg flex items-center gap-1"
                                >
                                  <CalendarDays className="w-3 h-3 text-blue-500" />
                                  <span>Rinuncia Giorni</span>
                                </button>
                              )}

                              {/* Cancella/Disdici Periodo */}
                              <button
                                type="button"
                                onClick={() => handleCancelSubscription(sub)}
                                className="px-2.5 py-1 text-[10px] bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-600 font-extrabold rounded-lg flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3 text-rose-500" />
                                <span>Disdici Periodo</span>
                              </button>

                            </div>
                          )}
                        </div>
                      );
                    })
                ) : (
                  <div className="text-center py-6 text-xs text-slate-400">
                    Nessun abbonamento registrato per questo cliente. Aggiungi il primo periodo premendo "+ Aggiungi periodo".
                  </div>
                )}
              </div>
            </div>

            {/* 4. CALENDARIO PRESENZE (SOLO TIPO B) */}
            {selectedCustomer.dealType === "pay_per_day" && (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Mini-Calendario Presenze (Accordo Tipo B)</h4>
                
                {(() => {
                  const custSubs = subscriptions.filter(s => s.customerId === selectedCustomerId && s.status === "active");
                  if (custSubs.length === 0) {
                    return <p className="text-xs text-slate-400">Nessun periodo attivo configurato per l'accordo B.</p>;
                  }

                  // Retrieve all dates inside sub periods
                  const allDates = custSubs.flatMap(s => {
                    let dates = getDatesInRange(s.startDate, s.endDate);
                    if (s.soloWeekend) {
                      dates = dates.filter((d) => {
                        const parts = d.split("-");
                        if (parts.length === 3) {
                          const year = Number(parts[0]);
                          const month = Number(parts[1]) - 1;
                          const day = Number(parts[2]);
                          const dateObj = new Date(year, month, day);
                          const dayOfWeek = dateObj.getDay();
                          return dayOfWeek === 0 || dayOfWeek === 6;
                        }
                        return false;
                      });
                    }
                    return dates.map(dt => ({
                      date: dt,
                      bedNumber: s.bedNumbers[0], // assume single/first bed
                      slot: s.slot
                    }));
                  }).sort((a,b) => a.date.localeCompare(b.date));

                  return (
                    <div className="space-y-3">
                      <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                        {allDates.map(({ date, bedNumber, slot }) => {
                          // Find attendance doc
                          const attDoc = attendance.find(a => a.customerId === selectedCustomerId && a.date === date && a.bedNumber === bedNumber);
                          
                          // Booking check
                          const hasBooking = bookings.some(b => b.customerId === selectedCustomerId && b.date === date && b.bedNumber === bedNumber);
                          
                          const status: "present" | "absent" | "unconfirmed" = attDoc 
                            ? attDoc.status 
                            : hasBooking ? "unconfirmed" : "absent";

                          return (
                            <div key={`${date}_${bedNumber}`} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50/50">
                              <div className="space-y-0.5">
                                <span className="font-bold text-slate-800">{formatItalianDate(date)}</span>
                                <span className="text-[10px] text-slate-400 block">Ombrellone {bedNumber} • {slot === "full_day" ? "Giornata" : "Fascia"}</span>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg ${
                                  status === "present"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : status === "absent"
                                      ? "bg-slate-100 text-slate-600"
                                      : "bg-amber-100 text-amber-800 animate-pulse"
                                }`}>
                                  {status === "present" ? (attDoc?.tipoGiornata === "mezza" ? "PRESENTE (1/2)" : "PRESENTE") : status === "absent" ? "ASSENTE" : "DA CONFERMARE"}
                                </span>

                                {status === "present" && (
                                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                    <button
                                      id={`toggle-intera-${date}_${bedNumber}`}
                                      type="button"
                                      onClick={() => handleUpdateAttendanceTipo(selectedCustomerId!, date, bedNumber, slot, "intera")}
                                      className={`px-1.5 py-0.5 text-[9px] font-black rounded-md transition-all cursor-pointer ${
                                        (attDoc?.tipoGiornata || "intera") === "intera"
                                          ? "bg-white text-slate-800 shadow-xs"
                                          : "text-slate-400 hover:text-slate-700"
                                      }`}
                                    >
                                      Intera
                                    </button>
                                    <button
                                      id={`toggle-mezza-${date}_${bedNumber}`}
                                      type="button"
                                      onClick={() => handleUpdateAttendanceTipo(selectedCustomerId!, date, bedNumber, slot, "mezza")}
                                      className={`px-1.5 py-0.5 text-[9px] font-black rounded-md transition-all cursor-pointer ${
                                        attDoc?.tipoGiornata === "mezza"
                                          ? "bg-white text-amber-700 shadow-xs"
                                          : "text-slate-400 hover:text-slate-700"
                                      }`}
                                    >
                                      Mezza
                                    </button>
                                  </div>
                                )}

                                {/* Confirm Buttons */}
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => handleMarkBAttendance(selectedCustomerId!, date, bedNumber, slot, "present")}
                                    disabled={status === "present"}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all ${
                                      status === "present"
                                        ? "bg-emerald-50 border-emerald-100 text-emerald-600 opacity-50 cursor-not-allowed"
                                        : "bg-white border-slate-200 hover:border-emerald-300 hover:text-emerald-600 text-slate-500"
                                    }`}
                                  >
                                    Presente
                                  </button>
                                  <button
                                    onClick={() => handleMarkBAttendance(selectedCustomerId!, date, bedNumber, slot, "absent")}
                                    disabled={status === "absent" && !hasBooking}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all ${
                                      status === "absent" && !hasBooking
                                        ? "bg-slate-50 border-slate-100 text-slate-400 opacity-50 cursor-not-allowed"
                                        : "bg-white border-slate-200 hover:border-rose-300 hover:text-rose-600 text-slate-500"
                                    }`}
                                  >
                                    Assente
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* RICONCILIAZIONE PRESENZE (STORICO DOCX) - Part C */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Riconciliazione Presenze (Storico Importazioni)</h4>
                  <p className="text-[10px] text-slate-500 font-semibold">Monitora e riconcilia le presenze caricate dai fogli di lavoro con l'abbonamento del cliente.</p>
                </div>
              </div>

              {(() => {
                const activeSubs = subscriptions.filter(s => s.customerId === selectedCustomerId && s.status === "active");
                if (activeSubs.length === 0) {
                  return <p className="text-xs text-slate-400 italic">Nessun periodo di abbonamento attivo configurato per questo cliente.</p>;
                }

                // Gather all subscription days/beds combinations
                const subscriptionDays: { date: string; bedNumber: number; slot: string; subscriptionId: string }[] = [];
                activeSubs.forEach((sub) => {
                  let dates = getDatesInRange(sub.startDate, sub.endDate);
                  if (sub.soloWeekend) {
                    dates = dates.filter((d) => {
                      const parts = d.split("-");
                      if (parts.length === 3) {
                        const year = Number(parts[0]);
                        const month = Number(parts[1]) - 1;
                        const day = Number(parts[2]);
                        const dateObj = new Date(year, month, day);
                        const dayOfWeek = dateObj.getDay();
                        return dayOfWeek === 0 || dayOfWeek === 6;
                      }
                      return false;
                    });
                  }
                  dates.forEach((dateStr) => {
                    sub.bedNumbers.forEach((bedNum) => {
                      subscriptionDays.push({
                        date: dateStr,
                        bedNumber: bedNum,
                        slot: sub.slot,
                        subscriptionId: sub.id!
                      });
                    });
                  });
                });

                if (subscriptionDays.length === 0) {
                  return <p className="text-xs text-slate-400 italic">Nessun giorno di presenza da monitorare nell'intervallo dell'abbonamento.</p>;
                }

                // Sort by date descending
                subscriptionDays.sort((a, b) => b.date.localeCompare(a.date));

                return (
                  <div className="max-h-[350px] overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                    {subscriptionDays.map((day, idx) => {
                      // Find if a presence document exists for this day and bed
                      const presence = dailyPresences.find(
                        dp => dp.date === day.date && Number(dp.bedNumber) === Number(day.bedNumber)
                      );

                      // Determine badges & actions
                      const isAbsentDoc = presence && presence.rawName === "ASSENTE_CONFIGURATO";

                      return (
                        <div key={`${day.date}_${day.bedNumber}_${idx}`} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50/50 transition-colors">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">{formatItalianDate(day.date)}</span>
                              <span className="text-[10px] font-mono text-slate-400">({day.date})</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                              <span>Lettino {day.bedNumber}</span>
                              <span>•</span>
                              <span>{day.slot === "full_day" ? "Giornata Intera" : day.slot === "morning" ? "Mattina" : "Pomeriggio"}</span>
                            </div>
                            {presence && (
                              <p className="text-[10px] font-bold text-[#025A70] bg-[#EAF4F6] px-2 py-0.5 rounded w-max mt-1">
                                Nome nel foglio: <span className="font-mono font-black italic">"{presence.rawName}"</span>
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5 self-end sm:self-center">
                            {/* Badges */}
                            {!presence ? (
                              <span className="text-[9px] font-black uppercase px-2 py-1 bg-slate-100 text-slate-600 rounded-lg">
                                Non Rilevato (Assente)
                              </span>
                            ) : isAbsentDoc ? (
                              <span className="text-[9px] font-black uppercase px-2 py-1 bg-rose-50 text-rose-700 border border-rose-100 rounded-lg">
                                Segnato Assente
                              </span>
                            ) : presence.matchStatus === "matched" ? (
                              <span className="text-[9px] font-black uppercase px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg">
                                Presenza Abbonato
                              </span>
                            ) : presence.matchStatus === "bed_period_match_name_mismatch" ? (
                              <span className="text-[9px] font-black uppercase px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg animate-pulse" title="Il nome rilevato differisce dall'abbonato">
                                Ospite / Altro
                              </span>
                            ) : (
                              <span className="text-[9px] font-black uppercase px-2 py-1 bg-slate-100 text-slate-500 rounded-lg">
                                {presence.matchStatus}
                              </span>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-1.5">
                              {presence && presence.matchStatus === "bed_period_match_name_mismatch" && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleReconcileManually(presence.id!, day.subscriptionId)}
                                  className="px-2.5 py-1 text-[10px] font-black bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm transition-all cursor-pointer shrink-0"
                                  title="Riconcilia manualmente questa presenza"
                                >
                                  Riconcilia
                                </button>
                              )}

                              {!presence && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleMarkAbsent(day.date, day.bedNumber, day.slot, day.subscriptionId)}
                                  className="px-2.5 py-1 text-[10px] font-black bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-all cursor-pointer shrink-0"
                                >
                                  Segna Assente
                                </button>
                              )}

                              {isAbsentDoc && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => handleRemoveAbsent(presence.id!)}
                                  className="px-2 py-1 text-[9px] font-black bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-all cursor-pointer shrink-0"
                                  title="Rimuovi lo stato di assenza"
                                >
                                  Rimuovi Assenza
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* 5. STORICO MOVIMENTI / LEDGER */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider block">Storico Movimenti (Ledger)</h4>
              
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {ledger.filter((l) => l.customerId === selectedCustomerId).length > 0 ? (
                  ledger
                    .filter((l) => l.customerId === selectedCustomerId)
                    .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
                    .map((entry) => {
                      let kindBadge = "bg-slate-50 text-slate-600";
                      let sign = "";
                      if (entry.kind === "payment") { kindBadge = "bg-emerald-50 text-emerald-700 border border-emerald-100"; sign = "+"; }
                      if (entry.kind === "deposit") { kindBadge = "bg-blue-50 text-blue-700 border border-blue-100"; sign = "+"; }
                      if (entry.kind === "day_waiver_credit") { kindBadge = "bg-purple-50 text-purple-700 border border-purple-100"; sign = "+"; }
                      if (entry.kind === "daily_charge") { kindBadge = "bg-amber-50 text-amber-700 border border-amber-100"; sign = "−"; }
                      if (entry.kind === "adjustment") { kindBadge = "bg-indigo-50 text-indigo-700 border border-indigo-100"; sign = entry.amount < 0 ? "−" : "+"; }

                      return (
                        <div
                          key={entry.id}
                          className="p-3 bg-slate-50 hover:bg-slate-100/60 rounded-xl flex items-center justify-between gap-3 text-xs border border-slate-100/50"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${kindBadge}`}>
                                {entry.kind === "payment" ? "Pagamento" : entry.kind === "deposit" ? "Caparra" : entry.kind === "day_waiver_credit" ? "Credito Rinuncia" : entry.kind === "daily_charge" ? "Addebito Presenza" : "Ricalcolo / Storno"}
                              </span>
                              <span className="text-slate-400 text-[10px] font-mono">{entry.date}</span>
                            </div>
                            <p className="font-semibold text-slate-700">{entry.note || "Nessuna nota aggiuntiva"}</p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`font-mono font-black text-sm ${
                              entry.kind === "payment" || entry.kind === "deposit" || entry.kind === "day_waiver_credit" ? "text-emerald-600" : "text-slate-800"
                            }`}>
                              {sign}{entry.amount}€
                            </span>

                            {/* Edit/Delete ledger entry */}
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  setEditLedgerEntry(entry);
                                  setEditLedgerAmount(entry.amount);
                                  setEditLedgerMethod(entry.method || "cash");
                                  setEditLedgerDate(entry.date);
                                  setEditLedgerNote(entry.note || "");
                                  setShowEditLedgerModal(true);
                                }}
                                className="p-1 text-slate-400 hover:text-blue-600 rounded"
                                title="Modifica"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteLedgerEntry(entry);
                                  setAlsoMarkAbsent(false);
                                  setShowDeleteLedgerModal(true);
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                title="Elimina"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <p className="text-xs text-slate-400 text-center py-6">Nessun movimento contabile registrato per questo cliente.</p>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 shadow-sm text-center text-slate-400 min-h-[400px] flex flex-col items-center justify-center space-y-3">
            <Users className="w-10 h-10 stroke-1 text-slate-300" />
            <h4 className="font-bold text-slate-600 text-sm">Nessun Cliente Selezionato</h4>
            <p className="text-xs max-w-sm">
              Seleziona un cliente dall'anagrafica di sinistra per gestirne i periodi, spostare ombrelloni, registrare pagamenti e consultare lo storico movimenti.
            </p>
          </div>
        )}

      </div>

      {/* ================= MODAL SECTIONS ================= */}

      {/* 1. ADD PERIOD MODAL */}
      {showAddPeriodModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Aggiungi Periodo di Abbonamento</h3>
              <button onClick={() => setShowAddPeriodModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleAddPeriod} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Ombrellon{newPeriodBeds.includes(",") ? "i" : "o"} *</label>
                <input
                  id="input-new-period-beds"
                  type="text"
                  required
                  placeholder="es. 66 oppure 66, 67"
                  value={newPeriodBeds}
                  onChange={(e) => setNewPeriodBeds(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Setup Configuration selectors (Only for Tipo A) */}
              {selectedCustomer?.dealType !== "pay_per_day" && (
                <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Setup Periodo & Tipologia</span>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Periodo Configurato</label>
                      <select
                        id="select-new-period-id"
                        value={newPeriodId}
                        onChange={(e) => handleNewPeriodIdChange(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none"
                      >
                        <option value="">-- Seleziona Periodo --</option>
                        {(subscriptionSetup?.periods || []).map((p: any) => (
                          <option key={p.id} value={p.id} disabled={!p.active}>
                            {p.label} {!p.active ? "(Disattivato)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Tipologia Ombrellone</label>
                      <select
                        id="select-new-slot-type-id"
                        value={newPeriodSlotTypeId}
                        onChange={(e) => setNewPeriodSlotTypeId(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none"
                      >
                        <option value="">-- Seleziona Tipologia --</option>
                        {(subscriptionSetup?.slotTypes || []).map((st: any) => (
                          <option key={st.id} value={st.id} disabled={!st.active}>
                            {st.label} {!st.active ? "(Disattivata)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Dal *</label>
                  <input
                    id="input-new-period-start"
                    type="date"
                    required
                    value={newPeriodStartDate}
                    onChange={(e) => setNewPeriodStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Al *</label>
                  <input
                    id="input-new-period-end"
                    type="date"
                    required
                    value={newPeriodEndDate}
                    onChange={(e) => setNewPeriodEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  />
                </div>
              </div>

              {newPeriodStartDate && newPeriodEndDate && (
                <div className="bg-slate-50 border border-slate-100/60 p-2.5 rounded-xl flex justify-between items-center text-xs text-slate-600">
                  <span>Giorni generati:</span>
                  <span className="font-bold text-slate-800">
                    {(() => {
                      let dates = getDatesInRange(newPeriodStartDate, newPeriodEndDate);
                      if (newPeriodSoloWeekend) {
                        dates = dates.filter(d => {
                          const parts = d.split("-");
                          if (parts.length === 3) {
                            const year = Number(parts[0]);
                            const month = Number(parts[1]) - 1;
                            const day = Number(parts[2]);
                            const dateObj = new Date(year, month, day);
                            const dayOfWeek = dateObj.getDay();
                            return dayOfWeek === 0 || dayOfWeek === 6;
                          }
                          return false;
                        });
                      }
                      return dates.length;
                    })()}{" "}
                    {newPeriodSoloWeekend ? "weekend (sab/dom)" : "giorni totali"}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Fascia Oraria *</label>
                  <select
                    id="select-new-period-slot"
                    value={newPeriodSlot}
                    onChange={(e) => setNewPeriodSlot(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  >
                    <option value="full_day">Giornata Intera</option>
                    <option value="morning">Mattina</option>
                    <option value="afternoon">Pomeriggio</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <input
                    id="checkbox-new-period-solo-weekend"
                    type="checkbox"
                    checked={newPeriodSoloWeekend}
                    onChange={(e) => setNewPeriodSoloWeekend(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                  />
                  <label htmlFor="checkbox-new-period-solo-weekend" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    Solo weekend
                  </label>
                </div>
              </div>
              
              <div className="space-y-3">
                {selectedCustomer?.dealType !== "pay_per_day" && (
                  <>
                    <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-3">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Configurazione Prezzo</span>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Regola Tariffaria</label>
                          <select
                            id="select-new-period-pricing-rule"
                            value={newPeriodPricingRule}
                            onChange={(e) => setNewPeriodPricingRule(e.target.value as any)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                          >
                            <option value="standard">Standard</option>
                            <option value="hotel_weekend">Hotel (Weekend, feriali gratis)</option>
                          </select>
                        </div>

                        {newPeriodPricingRule === "hotel_weekend" ? (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Tariffa Weekend (€)</label>
                            <input
                              id="input-new-period-weekend-rate"
                              type="number"
                              value={newPeriodWeekendRate}
                              onChange={(e) => setNewPeriodWeekendRate(Number(e.target.value))}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Modalità Prezzo</label>
                            <select
                              id="select-new-period-price-mode"
                              value={newPeriodPriceMode}
                              onChange={(e) => setNewPeriodPriceMode(e.target.value as any)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                            >
                              <option value="listino">A Listino</option>
                              <option value="concordato">Prezzo Concordato</option>
                              <option value="da_concordare">Da Concordare</option>
                            </select>
                          </div>
                        )}
                      </div>

                      {newPeriodPricingRule !== "hotel_weekend" && (
                        <div className="border-t border-slate-200/50 pt-2.5">
                          {newPeriodPriceMode === "listino" && (
                            <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
                              <span>Prezzo Listino calcolato:</span>
                              <span className="font-extrabold text-blue-600">{newPeriodPrice}€</span>
                            </div>
                          )}

                          {newPeriodPriceMode === "concordato" && (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Prezzo Concordato Pattuito (€)</label>
                              <input
                                id="input-new-period-agreed-price"
                                type="number"
                                required
                                placeholder="Inserisci prezzo concordato"
                                value={newPeriodAgreedPrice}
                                onChange={(e) => setNewPeriodAgreedPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                              />
                            </div>
                          )}

                          {newPeriodPriceMode === "da_concordare" && (
                            <div className="bg-amber-50 border border-amber-100 p-2.5 rounded-lg text-[10px] text-amber-800 font-medium">
                              L'abbonamento verrà salvato con stato <strong>DA CONCORDARE</strong> (escluso dal totale incassi previsti).
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {newPeriodPricingRule === "hotel_weekend" && (
                      <div className="bg-rose-50/60 border border-rose-100/40 p-3 rounded-xl text-[10px] text-rose-800 space-y-1">
                        <span className="font-bold">Dettaglio Tariffa Hotel:</span>
                        <p>
                          I giorni infrasettimanali (lun-ven) sono gratuiti.
                          I weekend (sab-dom) sono conteggiati a {newPeriodWeekendRate}€ al giorno per ciascun ombrellone.
                        </p>
                        <div className="font-semibold pt-1 border-t border-rose-100/30">
                          Prezzo Totale Calcolato: <span className="font-extrabold text-xs text-rose-900">{newPeriodPrice}€</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {conflictsList.length > 0 && (
                <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-[10px] text-rose-800 space-y-1">
                  <span className="font-bold block">Conflitti rilevati in Mappa:</span>
                  <ul className="list-disc pl-3 max-h-20 overflow-y-auto">
                    {conflictsList.map((c, i) => (
                      <li key={i}>{c.date} - Ombrellone {c.bedNumber} occupato da {c.customer}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPeriodModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  id="btn-submit-new-period"
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm"
                >
                  {saving ? "Generazione..." : "Salva e Genera"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODIFICA PREZZO MODAL */}
      {showEditSubPriceModal && selectedSubForEdit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Modifica Prezzo e Setup Abbonamento</h3>
              <button onClick={() => setShowEditSubPriceModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleSaveSubPriceAndSetup} className="space-y-4">
              <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-3">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Associazione Setup</span>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Periodo Configurato</label>
                    <select
                      id="select-edit-sub-period-id"
                      value={editSubPeriodId}
                      onChange={(e) => setEditSubPeriodId(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none"
                    >
                      <option value="">-- Nessun periodo associato --</option>
                      {(subscriptionSetup?.periods || []).map((p: any) => (
                        <option key={p.id} value={p.id} disabled={!p.active}>
                          {p.label} {!p.active ? "(Disattivato)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Tipologia Ombrellone</label>
                    <select
                      id="select-edit-sub-slot-type-id"
                      value={editSubSlotTypeId}
                      onChange={(e) => setEditSubSlotTypeId(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none"
                    >
                      <option value="">-- Nessuna tipologia associata --</option>
                      {(subscriptionSetup?.slotTypes || []).map((st: any) => (
                        <option key={st.id} value={st.id} disabled={!st.active}>
                          {st.label} {!st.active ? "(Disattivata)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-3">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Prezzo e Modalità</span>
                
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Modalità Prezzo</label>
                  <select
                    id="select-edit-sub-price-mode"
                    value={editSubPriceMode}
                    onChange={(e) => setEditSubPriceMode(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="listino">A Listino (Dinamico)</option>
                    <option value="concordato">Prezzo Concordato (Fisso)</option>
                    <option value="da_concordare">Da Concordare (Escluso dai totali)</option>
                  </select>
                </div>

                <div className="border-t border-slate-200/50 pt-2.5">
                  {editSubPriceMode === "listino" && (
                    <div className="bg-blue-50 border border-blue-100 p-2.5 rounded-lg text-[10px] text-blue-800 font-medium">
                      Calcolato dinamicamente dal Listino Prezzi corrente.
                    </div>
                  )}

                  {editSubPriceMode === "concordato" && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Prezzo Concordato (€)</label>
                      <input
                        id="input-edit-sub-agreed-price"
                        type="number"
                        required
                        placeholder="es. 450"
                        value={editSubAgreedPrice}
                        onChange={(e) => setEditSubAgreedPrice(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  )}

                  {editSubPriceMode === "da_concordare" && (
                    <div className="bg-amber-50 border border-amber-100 p-2.5 rounded-lg text-[10px] text-amber-800 font-medium">
                      Stato: <strong>DA CONCORDARE</strong>. Escluso dai calcoli del totale incassi previsti.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditSubPriceModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  id="btn-submit-edit-sub-price"
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm cursor-pointer"
                >
                  {saving ? "Salvataggio..." : "Salva Modifiche"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. SPOSTA OMBRELLONE MODAL */}
      {showMoveModal && moveSub && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Sposta Ombrellone / Migrazione</h3>
              <button onClick={() => setShowMoveModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleMoveSub} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Ombrellone di Destinazione *</label>
                <input
                  id="input-move-new-bed"
                  type="text"
                  required
                  placeholder="es. 72"
                  value={moveNewBed}
                  onChange={(e) => setMoveNewBed(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Data di Decorrenza Spostamento *</label>
                <input
                  id="input-move-date"
                  type="date"
                  required
                  min={moveSub.startDate}
                  max={moveSub.endDate}
                  value={moveEffectiveDate}
                  onChange={(e) => setMoveEffectiveDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                />
                <span className="text-[9px] text-slate-400">Le prenotazioni dal {moveEffectiveDate} in poi saranno migrate sul nuovo ombrellone.</span>
              </div>

              {conflictsList.length > 0 && (
                <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-[10px] text-rose-800 space-y-1">
                  <span className="font-bold block">Conflitti ombrellone destinazione:</span>
                  <ul className="list-disc pl-3 max-h-20 overflow-y-auto">
                    {conflictsList.map((c, i) => (
                      <li key={i}>{c.date} occupato da {c.customer}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMoveModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  id="btn-submit-move"
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm"
                >
                  {saving ? "Migrazione..." : "Conferma Spostamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. RINUNCIA GIORNI MODAL */}
      {showWaiverModal && waiverSub && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Rinuncia Giorni / Rimborso Credito</h3>
              <button onClick={() => setShowWaiverModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleWaiverSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Dal *</label>
                  <input
                    id="input-waiver-start"
                    type="date"
                    required
                    min={waiverSub.startDate}
                    max={waiverSub.endDate}
                    value={waiverStart}
                    onChange={(e) => setWaiverStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Al *</label>
                  <input
                    id="input-waiver-end"
                    type="date"
                    required
                    min={waiverSub.startDate}
                    max={waiverSub.endDate}
                    value={waiverEnd}
                    onChange={(e) => setWaiverEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Valore del Credito (€) - Modificabile</label>
                <div className="relative">
                  <input
                    id="input-waiver-credit"
                    type="number"
                    required
                    value={waiverCredit}
                    onChange={(e) => setWaiverCredit(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full pl-6 pr-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white"
                  />
                  <span className="absolute left-2.5 top-2 text-xs text-slate-400">€</span>
                </div>
                <span className="text-[9px] text-slate-400 block mt-1">Calcolato proporzionalmente sul costo del periodo. Le prenotazioni di questi giorni saranno cancellate per rendere l'ombrellone libero.</span>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWaiverModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  id="btn-submit-waiver"
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm"
                >
                  {saving ? "Calcolo..." : "Conferma Rinuncia"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 14. BONIFICA PRENOTAZIONI ORFANE MODAL */}
      {showBonificaModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-2xl w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <h3 className="font-extrabold text-sm text-slate-800 uppercase tracking-wider">Bonifica Prenotazioni Orfane</h3>
              </div>
              <button 
                type="button"
                onClick={() => setShowBonificaModal(false)} 
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-600 font-medium">
                Queste prenotazioni sono associate ad abbonamenti eliminati, inesistenti o disdetti/annullati. Non sono più valide e occupano posti sulla mappa.
              </p>
              {orphanBookings.length === 0 ? (
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-center text-xs font-bold text-emerald-700">
                  Nessuna prenotazione orfana trovata nel sistema! Ottimo lavoro!
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl text-xs font-bold text-amber-700">
                    Trovate {orphanBookings.length} prenotazioni orfane. Conferma l'eliminazione per liberare i posti sulla mappa.
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                    {orphanBookings.map((b) => (
                      <div key={b.id} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="space-y-0.5">
                          <span className="text-xs font-black text-slate-700 block">
                            {b.customerName || "Cliente sconosciuto"}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            ID Booking: {b.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-extrabold rounded-md">
                            Lettino: {b.bedNumber}
                          </span>
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-md">
                            Data: {formatItalianDate(b.date)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBonificaModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Annulla
              </button>
              {orphanBookings.length > 0 && (
                <button
                  type="button"
                  id="btn-confirm-bonifica"
                  onClick={handleExecuteBonifica}
                  disabled={saving}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{saving ? "Eliminazione..." : `Elimina ${orphanBookings.length} prenotazioni orfane`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. EDIT LEDGER ENTRY MODAL */}
      {showEditLedgerModal && editLedgerEntry && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Modifica Movimento Contabile</h3>
              <button onClick={() => setShowEditLedgerModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleEditLedgerSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Importo (€)</label>
                <input
                  type="number"
                  required
                  value={editLedgerAmount}
                  onChange={(e) => setEditLedgerAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                />
              </div>

              {editLedgerEntry.kind !== "adjustment" && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Metodo di Pagamento</label>
                  <select
                    value={editLedgerMethod}
                    onChange={(e) => setEditLedgerMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                  >
                    <option value="cash">Contanti</option>
                    <option value="card">Carta/POS</option>
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Data Movimento</label>
                <input
                  type="date"
                  required
                  value={editLedgerDate}
                  onChange={(e) => setEditLedgerDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Nota / Causale</label>
                <input
                  type="text"
                  value={editLedgerNote}
                  onChange={(e) => setEditLedgerNote(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditLedgerModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm"
                >
                  {saving ? "Aggiornamento..." : "Salva Modifiche"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DELETE LEDGER CONFIRMATION MODAL */}
      {showDeleteLedgerModal && deleteLedgerEntry && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Conferma Eliminazione</h3>
              <button onClick={() => setShowDeleteLedgerModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Sicuro di voler eliminare questo movimento contabile di <strong>{deleteLedgerEntry.amount}€</strong> del {deleteLedgerEntry.date}? L'operazione ricalcolerà il residuo del cliente.
              </p>

              {deleteLedgerEntry.kind === "daily_charge" && (
                <div className="flex items-center gap-2 bg-amber-50 p-3 rounded-xl border border-amber-100">
                  <input
                    id="checkbox-mark-absent"
                    type="checkbox"
                    checked={alsoMarkAbsent}
                    onChange={(e) => setAlsoMarkAbsent(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="checkbox-mark-absent" className="text-[10px] font-bold text-amber-800 leading-tight">
                    Segna anche la giornata come ASSENTE (cancella la prenotazione e libera l'ombrellone in mappa)
                  </label>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteLedgerModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
              >
                Annulla
              </button>
              <button
                id="btn-confirm-delete-ledger"
                onClick={handleDeleteLedgerConfirm}
                disabled={saving}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-sm"
              >
                {saving ? "Eliminazione..." : "Elimina Movimento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. JSON IMPORT MODAL */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">Importa Anagrafiche Clienti (JSON)</h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] text-slate-500 leading-normal">
                Incolla un JSON array contenente gli oggetti cliente con campi: <code>name</code>, <code>phone</code>, <code>tipo_accordo</code> (oppure <code>dealType</code>: seasonal/pay_per_day), <code>notes</code>.
              </p>

              <textarea
                id="textarea-json-import"
                rows={6}
                placeholder='[{"name": "Rossi Mario", "phone": "33312345", "dealType": "seasonal"}]'
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-mono resize-none focus:bg-white"
              />

              {importStatus && (
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl text-[10px] font-bold text-slate-600">
                  {importStatus}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowImportModal(false); setImportStatus(null); }}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50"
              >
                Chiudi
              </button>
              <button
                id="btn-confirm-import"
                onClick={handleBulkImport}
                disabled={saving || !jsonText.trim()}
                className="px-5 py-2 bg-[#025A70] hover:bg-[#014152] text-white text-xs font-bold rounded-xl shadow-sm"
              >
                {saving ? "Caricamento..." : "Esegui Importazione"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. DELETE CUSTOMER CASCADING MODAL */}
      {showDeleteCustomerModal && selectedCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Eliminazione Cascata Cliente</span>
              </h3>
              <button onClick={() => setShowDeleteCustomerModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-normal font-medium">
                Stai per eliminare definitivamente il cliente <strong className="text-slate-950 font-black">{selectedCustomer.name}</strong>.
                Questa azione è <span className="text-rose-600 font-extrabold">irreversibile</span> e comporterà la cancellazione dei seguenti dati associati:
              </p>

              {(() => {
                const subIds = subscriptions.filter(s => s.customerId === selectedCustomer.id).map(s => s.id).filter(Boolean);
                const subCount = subIds.length;
                const bookingCount = bookings.filter(b => 
                  b.customerId === selectedCustomer.id || 
                  (b.subscriptionId && subIds.includes(b.subscriptionId))
                ).length;
                const ledgerCount = ledger.filter(l => l.customerId === selectedCustomer.id).length;
                const attCount = attendance.filter(a => a.customerId === selectedCustomer.id).length;

                return (
                  <div className="bg-rose-50 border border-rose-100/50 p-4 rounded-xl space-y-2">
                    <span className="text-[10px] font-black text-rose-800 uppercase tracking-wider block">Riepilogo elementi da cancellare:</span>
                    <ul className="text-xs text-rose-700 font-semibold space-y-1.5 list-disc list-inside">
                      <li>Documento Anagrafica Cliente</li>
                      <li><strong>{subCount}</strong> abbonamenti/periodi</li>
                      <li><strong>{bookingCount}</strong> prenotazioni attive/passate</li>
                      <li><strong>{ledgerCount}</strong> movimenti contabili (pagamenti/addebiti)</li>
                      <li><strong>{attCount}</strong> presenze registrate</li>
                    </ul>
                  </div>
                );
              })()}

              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                Se elimini il cliente, tutte le sue prenotazioni verranno rimosse anche dalla mappa dei lettini e dal tabellone.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteCustomerModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                id="btn-confirm-delete-customer-cascade"
                onClick={handleDeleteCustomerCascade}
                disabled={saving}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {saving ? "Eliminazione..." : "Conferma Eliminazione Cascata"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. DELETE ALL CLIENTS WITHOUT SUBSCRIPTIONS MODAL */}
      {showDeleteAllNoSubsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Pulizia Anagrafiche Spurie</span>
              </h3>
              <button onClick={() => setShowDeleteAllNoSubsModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-normal font-medium">
                Stai per eliminare IN UN COLPO SOLO tutti i clienti che <span className="text-rose-600 font-extrabold">non hanno alcun abbonamento/periodo</span> salvato a sistema.
              </p>

              {(() => {
                const targets = customers.filter(cust => !subscriptions.some(s => s.customerId === cust.id));
                const count = targets.length;
                return (
                  <div className="bg-rose-50 border border-rose-100/50 p-4 rounded-xl space-y-1">
                    <span className="text-[10px] font-black text-rose-800 uppercase tracking-wider block">Elementi rilevati per la pulizia:</span>
                    <span className="text-lg font-black text-rose-700 block">
                      {count} Clienti Spurii
                    </span>
                    <p className="text-[10px] text-rose-600 font-semibold leading-relaxed">
                      Saranno cancellati i documenti cliente e tutti gli eventuali movimenti, presenze o prenotazioni isolate ad essi collegate.
                    </p>
                  </div>
                );
              })()}

              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                Questo rimuoverà tutte le card di anagrafica vuote generate dallo scanner, lasciando solo gli abbonati con un contratto vero e proprio.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteAllNoSubsModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                id="btn-confirm-delete-all-no-subs"
                onClick={handleDeleteAllCustomersNoSubs}
                disabled={saving}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {saving ? "Pulizia in corso..." : "Elimina Tutti i Clienti Spurii"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. DELETE ALL SPURIOUS CLIENTS CONFIRMATION MODAL */}
      {showDeleteAllSpuriousModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Pulizia Anagrafiche Spurie</span>
              </h3>
              <button onClick={() => setShowDeleteAllSpuriousModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-normal font-medium">
                Stai per eliminare <span className="text-rose-600 font-extrabold">in un colpo solo</span> tutti i clienti identificati come spurii (senza alcun abbonamento, senza movimenti contabili e senza accordo specificato).
              </p>

              {(() => {
                const targets = customers.filter(isCustomerSpurious);
                const count = targets.length;
                const sampleNames = targets.slice(0, 10).map(c => c.name);
                return (
                  <div className="space-y-3">
                    <div className="bg-rose-50 border border-rose-100/50 p-4 rounded-xl space-y-1">
                      <span className="text-[10px] font-black text-rose-800 uppercase tracking-wider block">Elementi rilevati per la pulizia:</span>
                      <span className="text-lg font-black text-rose-700 block">
                        {count} Clienti Spurii
                      </span>
                    </div>

                    {sampleNames.length > 0 && (
                      <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-1.5">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Esempio dei primi nomi:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {sampleNames.map((name, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-white border border-slate-100 rounded-md text-[10px] font-medium text-slate-600">
                              {name}
                            </span>
                          ))}
                          {count > 10 && (
                            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200/50 rounded-md text-[10px] font-bold text-slate-500">
                              e altri {count - 10}...
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                Nota: Le prenotazioni in mappa NON verranno toccate, rimarranno visibili come prenotazioni libere con nome denormalizzato.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteAllSpuriousModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                id="btn-confirm-delete-all-spurious"
                onClick={handleDeleteAllSpurious}
                disabled={saving}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {saving ? "Eliminazione..." : "Conferma Eliminazione Spurie"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. OMONIMO / HOMONYMS WARNING MODAL */}
      {showOmonimoModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Cliente omonimo rilevato</span>
              </h3>
              <button onClick={() => setShowOmonimoModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-normal">
              <p>
                Hai inserito un nome che coincide con un cliente già presente in anagrafica: <strong className="text-slate-900">{newCustName.trim()}</strong>.
              </p>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-2">
                <span className="font-bold text-amber-800 uppercase block text-[10px]">Clienti esistenti trovati:</span>
                {omonimoMatches.map((m) => (
                  <div key={m.id} className="flex justify-between items-center gap-2 border-b border-amber-100/40 last:border-0 pb-1.5 last:pb-0">
                    <div className="text-left">
                      <span className="font-semibold block text-slate-800">{m.name}</span>
                      {m.phone && <span className="text-[10px] text-slate-500 block">Tel: {m.phone}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectExistingOmonimo(m.id!)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg text-[10px] transition-all cursor-pointer"
                    >
                      È lo stesso cliente (Associa)
                    </button>
                  </div>
                ))}
              </div>

              <p className="italic text-[11px] text-slate-500">
                Se si tratta di due persone diverse (omonimi), puoi procedere creando un nuovo record distinto. Suggeriamo di aggiungere un dettaglio al nome (es. "Mario Rossi - Hotel") per distinguerli.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOmonimoModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Modifica Nome
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowOmonimoModal(false);
                  handleCreateCustomer(undefined, true);
                }}
                disabled={saving}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {saving ? "Creazione..." : "È un cliente diverso (Crea nuovo)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. CONFLICT RESOLUTION MODAL */}
      {showConflictModal && pendingSubscriptionData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-2xl w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Gestione Conflitti Prenotazioni</span>
              </h3>
              <button
                onClick={() => {
                  setShowConflictModal(false);
                  setPendingSubscriptionData(null);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-normal font-medium">
                I seguenti ombrelloni sono già occupati nei giorni indicati. Scegli come procedere per ciascun giorno di conflitto:
              </p>

              {/* Quick Actions Bar */}
              <div className="flex gap-2 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, "skip" | "overwrite"> = {};
                    conflictsList.forEach((c) => {
                      if (c.id) next[c.id] = "skip";
                    });
                    setConflictDecisions(next);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-[10px] font-extrabold rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  Salta tutti i conflitti
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, "skip" | "overwrite"> = {};
                    conflictsList.forEach((c) => {
                      if (c.id) next[c.id] = "overwrite";
                    });
                    setConflictDecisions(next);
                  }}
                  className="px-3 py-1.5 bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-700 text-[10px] font-extrabold rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  Sovrascrivi tutti
                </button>
              </div>

              {/* Conflicts List */}
              <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                {conflictsList.map((c, idx) => {
                  const decision = conflictDecisions[c.id || ""] || "skip";
                  return (
                    <div key={c.id || idx} className="p-3 flex justify-between items-center text-xs gap-4">
                      <div className="space-y-0.5 text-left">
                        <span className="font-semibold block text-slate-800">
                          Data: {formatItalianDate(c.date)}
                        </span>
                        <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
                          <span>Ombrellone: <strong className="text-slate-700 font-bold">{c.bedNumber}</strong></span>
                          <span>•</span>
                          <span>Occupante: <strong className="text-rose-600 font-bold">{c.customer}</strong></span>
                          <span>•</span>
                          <span className="capitalize">({c.slot === "full_day" ? "Intera" : c.slot === "morning" ? "Mattina" : "Pomeriggio"})</span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (c.id) {
                              setConflictDecisions((prev) => ({ ...prev, [c.id!]: "skip" }));
                            }
                          }}
                          className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                            decision === "skip"
                              ? "bg-slate-800 border-slate-800 text-white shadow-xs"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          Salta
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (c.id) {
                              setConflictDecisions((prev) => ({ ...prev, [c.id!]: "overwrite" }));
                            }
                          }}
                          className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                            decision === "overwrite"
                              ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          Sovrascrivi
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowConflictModal(false);
                  setPendingSubscriptionData(null);
                }}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => executeSubscriptionSave(pendingSubscriptionData, conflictsList, conflictDecisions)}
                disabled={saving}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {saving ? "Generazione in corso..." : "Conferma e Salva Abbonamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. PRINT SUBSCRIBERS MODAL */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Printer className="w-4 h-4 text-emerald-700" />
                <span>Stampa Elenco Abbonati</span>
              </h3>
              <button 
                onClick={() => setShowPrintModal(false)} 
                className="text-slate-400 hover:text-slate-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Date Filters */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Data Inizio *</label>
                  <input
                    id="print-start-date"
                    type="date"
                    required
                    value={printStartDate}
                    onChange={(e) => setPrintStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block">Data Fine *</label>
                  <input
                    id="print-end-date"
                    type="date"
                    required
                    value={printEndDate}
                    onChange={(e) => setPrintEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              {/* Pedana Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Pedana / Settore</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPrintPedana("sinistra")}
                    className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      printPedana === "sinistra"
                        ? "bg-emerald-700 border-emerald-700 text-white shadow-sm"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Sinistra (1-34)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintPedana("destra")}
                    className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      printPedana === "destra"
                        ? "bg-emerald-700 border-emerald-700 text-white shadow-sm"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Destra (60+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintPedana("entrambe")}
                    className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      printPedana === "entrambe"
                        ? "bg-emerald-700 border-emerald-700 text-white shadow-sm"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Entrambe
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100/80 p-3 rounded-xl text-[10px] text-slate-500 space-y-1">
                <span className="font-bold block text-slate-700">Nota sulla generazione:</span>
                <p>
                  Verranno estratti tutti gli abbonamenti con date attive sovrapposte all'intervallo indicato. Gli abbonati con letti multipli avranno righe distinte, ordinate per numero letto.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                id="btn-print-generate-pdf"
                onClick={handleGeneratePDF}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                Genera PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. BULK IMPORT SUBSCRIBERS MODAL */}
      {showBulkImportModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 shrink-0">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#025A70]" />
                <span>Importazione Massiva Abbonati (Bulk Import)</span>
              </h3>
              <button 
                onClick={() => {
                  setShowBulkImportModal(false);
                  setBulkInputText("");
                  setParsedRows([]);
                  setParsingErrors([]);
                }} 
                className="text-slate-400 hover:text-slate-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Formato Istruzioni */}
              <div className="bg-slate-50 border border-slate-100/80 p-3 rounded-xl text-xs text-slate-600 space-y-1">
                <span className="font-bold text-slate-800">Formato di input (una riga per prenotazione):</span>
                <p className="font-mono text-[10px] bg-slate-100 p-1.5 rounded text-slate-700">
                  Nome | Letto | DataInizio | DataFine<br />
                  Esempio:<br />
                  Andrea Rugeri | 90 | 2026-07-12 | 2026-07-12<br />
                  Arditi | 66 | 2026-07-11 | 2026-07-17
                </p>
                <p className="text-[10px] text-slate-500">
                  Nota: Se un cliente ha più letti o periodi, inserisci più righe con lo stesso nome. Verrà creato un unico record cliente e più abbonamenti associati.
                </p>
              </div>

              {/* Textarea for Input */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase block">Incolla qui l'elenco abbonati</label>
                <textarea
                  id="bulk-import-textarea"
                  rows={6}
                  value={bulkInputText}
                  onChange={(e) => setBulkInputText(e.target.value)}
                  placeholder="Incolla qui..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-mono focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>

              {/* Analyze Button */}
              <div className="flex justify-start">
                <button
                  type="button"
                  id="btn-bulk-import-analyze"
                  onClick={handleAnalyzeBulk}
                  className="px-4 py-2 bg-[#025A70] hover:bg-[#014152] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  Analizza dati
                </button>
              </div>

              {/* Parsing Errors Display */}
              {parsingErrors.length > 0 && (
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-rose-700 font-bold text-xs">
                    <AlertCircle className="w-4 h-4" />
                    <span>Errori di formattazione o validazione:</span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-rose-600 space-y-1 max-h-40 overflow-y-auto">
                    {parsingErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview Table */}
              {parsedRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Anteprima Importazione ({parsedRows.length} righe rilevate)</span>
                    
                    {/* Checkbox Importa Comunque */}
                    {parsedRows.some(r => r.conflict) && (
                      <label className="flex items-center gap-2 text-xs font-bold text-amber-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={ignoreConflicts}
                          onChange={(e) => setIgnoreConflicts(e.target.checked)}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span>Importa comunque ignorando i conflitti</span>
                      </label>
                    )}
                  </div>

                  <div className="border border-slate-100 rounded-xl overflow-hidden overflow-x-auto max-h-80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-100">
                          <th className="p-3 text-center w-12">Riga</th>
                          <th className="p-3">Nome Cliente</th>
                          <th className="p-3 text-center w-20">Letto</th>
                          <th className="p-3">Periodo</th>
                          <th className="p-3">Stato Cliente</th>
                          <th className="p-3">Stato Letto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {parsedRows.map((row) => (
                          <tr 
                            key={row.lineNum} 
                            className={`transition-colors ${
                              row.conflict 
                                ? "bg-rose-50/70 hover:bg-rose-50 text-rose-900" 
                                : "hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <td className="p-3 text-center font-mono text-[10px] text-slate-400">{row.lineNum}</td>
                            <td className="p-3 font-medium">{row.customerName}</td>
                            <td className="p-3 text-center font-bold">{row.bedNumber}</td>
                            <td className="p-3 font-mono text-[11px]">{row.startDate} &rarr; {row.endDate}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                row.status === "Nuovo cliente"
                                  ? "bg-blue-50 text-blue-700 border border-blue-100"
                                  : "bg-slate-100 text-slate-600 border border-slate-200"
                              }`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="p-3">
                              {row.conflict ? (
                                <span className="text-[10px] font-bold text-rose-600 flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>CONFLITTO: {row.conflictReason}</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                  <span>Libero</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowBulkImportModal(false);
                  setBulkInputText("");
                  setParsedRows([]);
                  setParsingErrors([]);
                }}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                id="btn-bulk-import-confirm"
                disabled={isImporting || parsedRows.length === 0 || (parsedRows.some(r => r.conflict) && !ignoreConflicts)}
                onClick={handleConfirmBulkImport}
                className={`px-5 py-2 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5 ${
                  isImporting || parsedRows.length === 0 || (parsedRows.some(r => r.conflict) && !ignoreConflicts)
                    ? "bg-slate-300 cursor-not-allowed text-slate-400"
                    : "bg-emerald-700 hover:bg-emerald-800 cursor-pointer"
                }`}
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Importazione in corso...</span>
                  </>
                ) : (
                  <span>Conferma Importazione</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Helper: check if a customer has payments
function custLedgerHasPayments(customerId: string, ledger: LedgerEntry[]) {
  return ledger.some((l) => l.customerId === customerId && (l.kind === "payment" || l.kind === "deposit"));
}
