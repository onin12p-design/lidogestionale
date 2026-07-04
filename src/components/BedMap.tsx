import React from "react";
import { Booking, Tab, Payment } from "../types";
import { Coffee, CheckCircle, AlertCircle, HelpCircle } from "lucide-react";

// PEDANA SINISTRA — griglia sinistra (4 righe, ultima riga da 4)
const PEDANA_SINISTRA_LEFT = [
  [1, 2, 3, 4, 5],
  [11, 12, 13, 14, 15],
  [21, 22, 23, 24, 25],
  [31, 32, 33, 34, null]
];

// PEDANA SINISTRA — griglia destra (3 righe)
const PEDANA_SINISTRA_RIGHT = [
  [6, 7, 8, 9, 10],
  [16, 17, 18, 19, 20],
  [26, 27, 28, 29, 30]
];

// PEDANA DESTRA — griglia sinistra (4 righe)
const PEDANA_DESTRA_LEFT = [
  [60, 61, 62, 63, 64],
  [71, 72, 73, 74, 75],
  [82, 83, 84, 85, 86],
  [93, 94, 95, 96, 97]
];

// PEDANA DESTRA — griglia destra (5 righe, ultima riga in ordine INVERTITO 109→104)
const PEDANA_DESTRA_RIGHT = [
  [65, 66, 67, 68, 69, 70],
  [76, 77, 78, 79, 80, 81],
  [87, 88, 89, 90, 91, 92],
  [98, 99, 100, 101, 102, 103],
  [109, 108, 107, 106, 105, 104]
];

interface BedMapProps {
  bookings?: Booking[];
  tabs?: Tab[];
  payments?: Payment[];
  onBedSelect?: (bedNumber: number) => void;
  selectedBed?: number | null;
  isClientView?: boolean;
  availability?: { bedNumber: number; status: "free" | "morning_free" | "afternoon_free" | "full" }[];
}

export default function BedMap({
  bookings = [],
  tabs = [],
  payments = [],
  onBedSelect,
  selectedBed = null,
  isClientView = false,
  availability = []
}: BedMapProps) {
  
  // Helper to get booking details for a bed number
  const getBedBookingStatus = (bedNum: number) => {
    if (isClientView) {
      const found = availability.find((a) => a.bedNumber === bedNum);
      const status = found ? found.status : "free";
      return { state: status, isSubscriber: false, bookingsOnBed: [] };
    }

    const bedBookings = bookings.filter((b) => b.bedNumber === bedNum);
    if (bedBookings.length === 0) return { state: "free", bookingsOnBed: [] };

    const morning = bedBookings.find((b) => b.slot === "morning");
    const afternoon = bedBookings.find((b) => b.slot === "afternoon");
    const fullDay = bedBookings.find((b) => b.slot === "full_day");

    let isSubscriber = bedBookings.some((b) => b.customerType === "subscriber");

    if (fullDay) {
      return { state: "full_day", isSubscriber, bookingsOnBed: [fullDay] };
    } else if (morning && afternoon) {
      return { state: "split_full_day", isSubscriber, bookingsOnBed: [morning, afternoon] };
    } else if (morning) {
      return { state: "morning", isSubscriber, bookingsOnBed: [morning] };
    } else if (afternoon) {
      return { state: "afternoon", isSubscriber, bookingsOnBed: [afternoon] };
    }

    return { state: "free", bookingsOnBed: [] };
  };

  // Helper to get payment and tab indicator for a bed
  const getBedIndicators = (bedNum: number, bookingsOnBed: Booking[]) => {
    if (isClientView || bookingsOnBed.length === 0) return { payment: "none", hasOpenTab: false };

    // Check tabs
    const bedTabs = tabs.filter((t) => t.bedNumber === bedNum && !t.paid);
    const hasOpenTab = bedTabs.length > 0 && bedTabs.some(t => t.items.length > 0);

    // Calculate payments
    let totalPaid = 0;
    let expectedPrice = 0;

    bookingsOnBed.forEach(booking => {
      const bPayments = payments.filter(p => p.bookingId === booking.id);
      bPayments.forEach(p => totalPaid += p.amount);

      if (booking.subscriptionId) {
        const sPayments = payments.filter(p => p.subscriptionId === booking.subscriptionId);
        sPayments.forEach(p => totalPaid += p.amount);
      }

      if (booking.slot === "full_day") expectedPrice += 30;
      else expectedPrice += 15;
    });

    let paymentStatus: "paid" | "unpaid" | "deposit" = "unpaid";
    if (totalPaid > 0) {
      if (totalPaid >= expectedPrice) {
        paymentStatus = "paid";
      } else {
        paymentStatus = "deposit";
      }
    } else {
      paymentStatus = "unpaid";
    }

    return { payment: paymentStatus, hasOpenTab };
  };

  const renderBedCell = (bedNum: number | null) => {
    if (bedNum === null) {
      return <div key="null-cell" className="w-10 h-10 md:w-12 md:h-12 bg-transparent"></div>;
    }

    const { state, isSubscriber, bookingsOnBed } = getBedBookingStatus(bedNum);
    const { payment, hasOpenTab } = getBedIndicators(bedNum, bookingsOnBed);
    const isSelected = selectedBed === bedNum;

    let bgClass = "bg-white border-slate-200 hover:border-blue-400";
    let textClass = "text-slate-700";

    if (isClientView) {
      if (state === "free") {
        bgClass = "bg-white border-slate-200 cursor-default";
        textClass = "text-slate-700";
      } else if (state === "morning_free") {
        // Afternoon occupied, morning free
        bgClass = "bg-gradient-to-t from-sky-100 via-sky-50 to-white border-sky-200 cursor-default";
        textClass = "text-sky-950 font-bold";
      } else if (state === "afternoon_free") {
        // Morning occupied, afternoon free
        bgClass = "bg-gradient-to-b from-amber-100 via-amber-50 to-white border-amber-200 cursor-default";
        textClass = "text-amber-950 font-bold";
      } else if (state === "full") {
        bgClass = "bg-slate-200 border-slate-300 cursor-default";
        textClass = "text-slate-500 font-semibold";
      }
    } else {
      if (state === "full_day" || state === "split_full_day") {
        bgClass = isSubscriber 
          ? "bg-purple-100 border-purple-300 hover:bg-purple-200" 
          : "bg-emerald-100 border-emerald-300 hover:bg-emerald-200";
        textClass = isSubscriber ? "text-purple-900 font-semibold" : "text-emerald-900 font-semibold";
      } else if (state === "morning") {
        bgClass = isSubscriber
          ? "bg-gradient-to-b from-purple-100 via-purple-50 to-white border-purple-300"
          : "bg-gradient-to-b from-amber-100 via-amber-50 to-white border-amber-300";
        textClass = isSubscriber ? "text-purple-900" : "text-amber-900";
      } else if (state === "afternoon") {
        bgClass = isSubscriber
          ? "bg-gradient-to-t from-purple-100 via-purple-50 to-white border-purple-300"
          : "bg-gradient-to-t from-sky-100 via-sky-50 to-white border-sky-300";
        textClass = isSubscriber ? "text-purple-900" : "text-sky-900";
      }
    }

    const selectedClass = isSelected 
      ? "ring-4 ring-blue-500 ring-offset-1 border-blue-500 scale-105 z-10" 
      : "";

    return (
      <button
        key={`bed-${bedNum}`}
        id={`btn-bed-${bedNum}`}
        onClick={() => !isClientView && onBedSelect && onBedSelect(bedNum)}
        disabled={isClientView}
        className={`w-10 h-10 md:w-12 md:h-12 border rounded-lg flex flex-col items-center justify-center relative transition-all duration-150 ${bgClass} ${textClass} ${selectedClass}`}
      >
        <span className="text-xs md:text-sm font-bold">{bedNum}</span>
        
        {/* Indicators bar */}
        {!isClientView && (
          <div className="absolute bottom-1 flex gap-1 items-center justify-center w-full px-1">
            {state !== "free" && (
              <span
                id={`payment-dot-${bedNum}`}
                className={`w-1.5 h-1.5 rounded-full ${
                  payment === "paid" 
                    ? "bg-emerald-500" 
                    : payment === "deposit" 
                    ? "bg-amber-400" 
                    : "bg-rose-500"
                }`}
                title={payment === "paid" ? "Saldato" : payment === "deposit" ? "Acconto" : "Non pagato"}
              />
            )}

            {hasOpenTab && (
              <Coffee id={`tab-icon-${bedNum}`} className="w-2.5 h-2.5 text-amber-600" title="Consumazioni aperte" />
            )}
          </div>
        )}

        {/* Small badge for subscriber */}
        {!isClientView && isSubscriber && state !== "free" && (
          <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-purple-600" title="Abbonato" />
        )}
      </button>
    );
  };

  return (
    <div id="beach-map-container" className="flex flex-col gap-8 w-full select-none">
      
      {/* Legend */}
      {isClientView ? (
        <div id="map-legend" className="flex flex-wrap gap-4 items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-white border border-slate-200 rounded"></div>
            <span>Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-t from-sky-100 to-white border border-sky-300 rounded"></div>
            <span>Parzialmente occupato (Mattina Libera)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-b from-amber-100 to-white border border-amber-300 rounded"></div>
            <span>Parzialmente occupato (Pomeriggio Libero)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-slate-200 border border-slate-300 rounded"></div>
            <span>Occupato</span>
          </div>
        </div>
      ) : (
        <div id="map-legend" className="flex flex-wrap gap-4 items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-white border border-slate-200 rounded"></div>
            <span>Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-emerald-100 border border-emerald-300 rounded"></div>
            <span>Giornaliero Intero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-purple-100 border border-purple-300 rounded"></div>
            <span>Abbonato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-b from-amber-100 to-white border border-amber-300 rounded"></div>
            <span>Occupato Mattina (AM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-t from-sky-100 to-white border border-sky-300 rounded"></div>
            <span>Occupato Pomeriggio (PM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span>Saldato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400"></div>
            <span>Acconto</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-rose-500"></div>
            <span>Non Pagato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Coffee className="w-3.5 h-3.5 text-amber-600" />
            <span>Tab Consumazioni</span>
          </div>
        </div>
      )}

      {/* Grid Layout of Pedane */}
      <div id="pedane-grid" className="flex flex-col lg:flex-row gap-8 justify-center items-start w-full overflow-x-auto pb-4">
        
        {/* PEDANA SINISTRA */}
        <div id="pedana-sinistra" className="flex flex-col items-center p-4 bg-slate-50/50 rounded-2xl border border-slate-100 shadow-sm min-w-[340px]">
          <h3 className="text-sm font-bold text-slate-700 mb-3 tracking-wider uppercase">Pedana Sinistra</h3>
          <div className="flex gap-4">
            {/* Griglia Sinistra */}
            <div className="flex flex-col gap-1.5">
              {PEDANA_SINISTRA_LEFT.map((row, rIdx) => (
                <div key={`ps-left-row-${rIdx}`} className="flex gap-1.5">
                  {row.map((bedNum) => renderBedCell(bedNum))}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="w-px bg-slate-200 self-stretch my-2"></div>

            {/* Griglia Destra */}
            <div className="flex flex-col gap-1.5">
              {PEDANA_SINISTRA_RIGHT.map((row, rIdx) => (
                <div key={`ps-right-row-${rIdx}`} className="flex gap-1.5">
                  {row.map((bedNum) => renderBedCell(bedNum))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* PEDANA DESTRA */}
        <div id="pedana-destra" className="flex flex-col items-center p-4 bg-slate-50/50 rounded-2xl border border-slate-100 shadow-sm min-w-[400px]">
          <h3 className="text-sm font-bold text-slate-700 mb-3 tracking-wider uppercase">Pedana Destra</h3>
          <div className="flex gap-4">
            {/* Griglia Sinistra */}
            <div className="flex flex-col gap-1.5">
              {PEDANA_DESTRA_LEFT.map((row, rIdx) => (
                <div key={`pd-left-row-${rIdx}`} className="flex gap-1.5">
                  {row.map((bedNum) => renderBedCell(bedNum))}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="w-px bg-slate-200 self-stretch my-2"></div>

            {/* Griglia Destra */}
            <div className="flex flex-col gap-1.5">
              {PEDANA_DESTRA_RIGHT.map((row, rIdx) => (
                <div key={`pd-right-row-${rIdx}`} className="flex gap-1.5">
                  {row.map((bedNum) => renderBedCell(bedNum))}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
