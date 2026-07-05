import React from "react";
import { Booking, Tab, Payment } from "../types";
import { Coffee, CheckCircle, AlertCircle, HelpCircle } from "lucide-react";
import { getPriceForBooking } from "../utils";

// PEDANA SINISTRA — griglia sinistra (4 righe, ultima riga da 4)
export const PEDANA_SINISTRA_LEFT = [
  [1, 2, 3, 4, 5],
  [11, 12, 13, 14, 15],
  [21, 22, 23, 24, 25],
  [31, 32, 33, 34, null]
];

// PEDANA SINISTRA — griglia destra (3 righe)
export const PEDANA_SINISTRA_RIGHT = [
  [6, 7, 8, 9, 10],
  [16, 17, 18, 19, 20],
  [26, 27, 28, 29, 30]
];

// PEDANA DESTRA — griglia sinistra (4 righe)
export const PEDANA_DESTRA_LEFT = [
  [60, 61, 62, 63, 64],
  [71, 72, 73, 74, 75],
  [82, 83, 84, 85, 86],
  [93, 94, 95, 96, 97]
];

// PEDANA DESTRA — griglia destra (5 righe, ultima riga in ordine INVERTITO 109→104)
export const PEDANA_DESTRA_RIGHT = [
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
  isExpanded?: boolean;
  availability?: { bedNumber: number; status: "free" | "morning_free" | "afternoon_free" | "full" }[];
  pricingConfigs?: any[];
}

export default function BedMap({
  bookings = [],
  tabs = [],
  payments = [],
  onBedSelect,
  selectedBed = null,
  isClientView = false,
  isExpanded = false,
  availability = [],
  pricingConfigs = []
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

      expectedPrice += getPriceForBooking(booking.date, booking.bedNumber, booking.slot, pricingConfigs);
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

  const formatDisplayName = (fullName: string) => {
    if (!fullName) return { first: "", last: "" };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
      return {
        first: parts[0].substring(0, 12),
        last: ""
      };
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    return {
      first: first.substring(0, 11),
      last: last.substring(0, 11)
    };
  };

  const getBedNames = (bookingsOnBed: Booking[]) => {
    if (bookingsOnBed.length === 0) return null;
    const morning = bookingsOnBed.find(b => b.slot === "morning");
    const afternoon = bookingsOnBed.find(b => b.slot === "afternoon");
    const fullDay = bookingsOnBed.find(b => b.slot === "full_day");

    if (fullDay) {
      return { fullDay: fullDay.customerName };
    }
    return {
      morning: morning ? morning.customerName : null,
      afternoon: afternoon ? afternoon.customerName : null
    };
  };

  const renderBedCell = (bedNum: number | null, key: string) => {
    if (bedNum === null) {
      return <div key={key} className="w-full aspect-square bg-transparent"></div>;
    }

    const { state, isSubscriber, bookingsOnBed } = getBedBookingStatus(bedNum);
    const { payment, hasOpenTab } = getBedIndicators(bedNum, bookingsOnBed);
    const isSelected = selectedBed === bedNum;

    let bgClass = "bg-[#EAF4F6] border-[#B3D5DC] hover:border-[#025A70]";
    let textClass = "text-[#025A70]";

    if (isClientView) {
      if (state === "free") {
        bgClass = "bg-[#EAF4F6] border-[#B3D5DC] hover:bg-[#D5EAEF] transition-all";
        textClass = "text-[#025A70] font-black";
      } else if (state === "morning_free") {
        // Afternoon occupied, morning free
        bgClass = "bg-gradient-to-t from-slate-100 via-white to-[#EAF4F6] border-[#B3D5DC]";
        textClass = "text-[#025A70] font-bold";
      } else if (state === "afternoon_free") {
        // Morning occupied, afternoon free
        bgClass = "bg-gradient-to-b from-[#EAF4F6] via-white to-slate-100 border-[#B3D5DC]";
        textClass = "text-[#025A70] font-bold";
      } else if (state === "full") {
        bgClass = "bg-[#F3EFE6]/80 border-[#E5DFD3] opacity-60 cursor-not-allowed";
        textClass = "text-[#A29783] font-semibold line-through";
      }
    } else {
      if (state === "free") {
        bgClass = "bg-[#EAF4F6] border-[#B3D5DC] hover:bg-[#D5EAEF] hover:border-[#025A70]";
        textClass = "text-[#025A70] font-bold";
      } else if (state === "full_day" || state === "split_full_day") {
        bgClass = isSubscriber 
          ? "bg-[#F9F1E2] border-[#E2D1B3] hover:bg-[#F2E4CD]" 
          : "bg-[#D5EAEF] border-[#99CCD6] hover:bg-[#BBDDE5]";
        textClass = isSubscriber ? "text-[#8A6D3B] font-extrabold" : "text-[#025A70] font-extrabold";
      } else if (state === "morning") {
        bgClass = isSubscriber
          ? "bg-gradient-to-b from-[#F9F1E2] via-[#FDFAED] to-white border-[#E2D1B3]"
          : "bg-gradient-to-b from-[#D5EAEF] via-[#EAF4F6] to-white border-[#99CCD6]";
        textClass = isSubscriber ? "text-[#8A6D3B] font-bold" : "text-[#025A70] font-bold";
      } else if (state === "afternoon") {
        bgClass = isSubscriber
          ? "bg-gradient-to-t from-[#F9F1E2] via-[#FDFAED] to-white border-[#E2D1B3]"
          : "bg-gradient-to-t from-[#D5EAEF] via-[#EAF4F6] to-white border-[#99CCD6]";
        textClass = isSubscriber ? "text-[#8A6D3B] font-bold" : "text-[#025A70] font-bold";
      }
    }

    const selectedClass = isSelected 
      ? "ring-4 ring-[#F2A104] border-[#F2A104] scale-105 z-10 animate-pulse" 
      : "";

    const btnSizeClass = isClientView
      ? "w-full aspect-square min-w-[32px] min-h-[32px] sm:min-w-[40px] sm:min-h-[40px] max-w-[52px] max-h-[52px]"
      : `w-full aspect-square ${
          isExpanded 
            ? "min-w-[60px] min-h-[60px] sm:min-w-[72px] sm:min-h-[72px] md:min-w-[84px] md:min-h-[84px] lg:min-w-[96px] lg:min-h-[96px] xl:min-w-[110px] xl:min-h-[110px] max-w-[160px]" 
            : "min-w-[52px] min-h-[52px] sm:min-w-[64px] sm:min-h-[64px] md:min-w-[76px] md:min-h-[76px] lg:min-w-[88px] lg:min-h-[88px] xl:min-w-[100px] xl:min-h-[100px] max-w-[140px]"
        } py-1.5 sm:py-2 px-1`;

    const names = getBedNames(bookingsOnBed);

    const tooltipTitle = bookingsOnBed.length > 0
      ? bookingsOnBed.map(b => `${b.slot === "full_day" ? "Giornata Intera" : b.slot === "morning" ? "Mattina" : "Pomeriggio"}: ${b.customerName}`).join(" | ")
      : `Lettino ${bedNum}`;

    return (
      <button
        key={key}
        id={`btn-bed-${bedNum}`}
        onClick={() => !isClientView && onBedSelect && onBedSelect(bedNum)}
        disabled={isClientView}
        title={tooltipTitle}
        className={`border rounded-md md:rounded-lg flex flex-col items-center justify-between relative transition-all duration-150 ${btnSizeClass} ${bgClass} ${textClass} ${selectedClass}`}
      >
        {/* Top section: Bed Number */}
        <div className="w-full text-center pt-0.5 sm:pt-1 relative">
          <span className="text-[10px] sm:text-xs md:text-sm font-extrabold leading-none">{bedNum}</span>
          
          {/* Small badge for subscriber */}
          {!isClientView && isSubscriber && state !== "free" && (
            <span className="absolute top-0 right-0.5 w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-[#8A6D3B] shrink-0" title="Abbonato" />
          )}
        </div>

        {/* Middle section: Names for management view */}
        {!isClientView && bookingsOnBed.length > 0 ? (
          <div className="w-full flex flex-col items-center justify-center px-0.5 my-0.5 pointer-events-none overflow-hidden leading-none">
            {names?.fullDay && (() => {
              const formatted = formatDisplayName(names.fullDay);
              return (
                <div className="flex flex-col items-center justify-center w-full text-center tracking-tight leading-none">
                  <span className="text-[8px] sm:text-[9.5px] md:text-[11px] lg:text-[12px] xl:text-[13px] font-black truncate w-full uppercase text-slate-800">
                    {formatted.first}
                  </span>
                  {formatted.last && (
                    <span className="text-[7px] sm:text-[8px] md:text-[9.5px] lg:text-[10px] xl:text-[11px] font-bold truncate w-full text-slate-500 uppercase mt-0.5">
                      {formatted.last}
                    </span>
                  )}
                </div>
              );
            })()}
            {names?.morning && (() => {
              const formatted = formatDisplayName(names.morning);
              return (
                <span className="text-[7.5px] sm:text-[8.5px] md:text-[9.5px] lg:text-[10.5px] xl:text-[11px] font-black truncate w-full text-center tracking-tight text-sky-800 uppercase leading-none" title={`Mattina: ${names.morning}`}>
                  M: {formatted.first}
                </span>
              );
            })()}
            {names?.afternoon && (() => {
              const formatted = formatDisplayName(names.afternoon);
              return (
                <span className="text-[7.5px] sm:text-[8.5px] md:text-[9.5px] lg:text-[10.5px] xl:text-[11px] font-black truncate w-full text-center tracking-tight text-amber-800 uppercase leading-none mt-0.5" title={`Pomeriggio: ${names.afternoon}`}>
                  P: {formatted.first}
                </span>
              );
            })()}
          </div>
        ) : (
          <div className="flex-1 pointer-events-none"></div>
        )}

        {/* Bottom section: Indicators */}
        {!isClientView ? (
          <div className="w-full flex gap-1 items-center justify-center pb-0.5 h-3 sm:h-4 px-0.5 pointer-events-none">
            {state !== "free" && (
              <span
                id={`payment-dot-${bedNum}`}
                className={`w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full shrink-0 ${
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
              <Coffee id={`tab-icon-${bedNum}`} className="w-2 sm:w-2.5 h-2 sm:h-2.5 text-amber-600 shrink-0" title="Consumazioni aperte" />
            )}
          </div>
        ) : (
          <div className="h-1 sm:h-2 pointer-events-none"></div>
        )}
      </button>
    );
  };

  return (
    <div id="beach-map-container" className="flex flex-col gap-8 w-full select-none">
      
      {/* Legend */}
      {isClientView ? (
        <div id="map-legend" className="flex flex-wrap gap-4 items-center justify-center p-3 bg-[#FDFBF7] rounded-xl border border-[#EFECE6] text-xs text-slate-600 shadow-sm shadow-[#F3EFE6]">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-[#EAF4F6] border border-[#B3D5DC] rounded"></div>
            <span>Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-t from-slate-100 to-[#EAF4F6] border border-[#B3D5DC] rounded"></div>
            <span>Parzialmente occupato (Mattina Libera)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-b from-[#EAF4F6] to-slate-100 border border-[#B3D5DC] rounded"></div>
            <span>Parzialmente occupato (Pomeriggio Libero)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-[#F3EFE6]/80 border border-[#E5DFD3] rounded"></div>
            <span>Occupato</span>
          </div>
        </div>
      ) : (
        <div id="map-legend" className="flex flex-wrap gap-4 items-center justify-center p-3 bg-[#FDFBF7] rounded-xl border border-[#EFECE6] text-xs text-slate-600 shadow-sm shadow-[#F3EFE6]">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-[#EAF4F6] border border-[#B3D5DC] rounded"></div>
            <span>Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-[#D5EAEF] border border-[#99CCD6] rounded"></div>
            <span>Giornaliero Intero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-[#F9F1E2] border border-[#E2D1B3] rounded"></div>
            <span>Abbonato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-b from-[#D5EAEF] to-white border border-[#99CCD6] rounded"></div>
            <span>Occupato Mattina (AM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-gradient-to-t from-[#D5EAEF] to-white border border-[#99CCD6] rounded"></div>
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
      <div id="pedane-grid" className="grid grid-cols-1 gap-6 xl:gap-8 w-full pb-4">
        
        {/* PEDANA SINISTRA */}
        <div id="pedana-sinistra" className="flex flex-col items-center p-3 sm:p-5 bg-[#FDFBF7] rounded-3xl border border-[#EFECE6] shadow-sm shadow-[#F3EFE6] w-full overflow-hidden">
          <h3 className="text-xs sm:text-sm font-extrabold text-[#025A70] mb-4 tracking-wider uppercase">Pedana Sinistra</h3>
          <div className="w-full overflow-x-auto pb-2 scrollbar-thin">
            <div className={`grid grid-cols-[5fr_5fr] gap-2 sm:gap-4 w-full ${isClientView ? "" : "min-w-[580px] md:min-w-full"}`}>
              {/* Griglia Sinistra */}
              <div className="grid grid-cols-5 gap-1 sm:gap-1.5 w-full justify-items-center pr-2 sm:pr-4 border-r border-[#EFECE6]">
                {PEDANA_SINISTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => 
                  renderBedCell(bedNum, `ps-left-${bedNum || "null"}-${idx}`)
                )}
              </div>

              {/* Griglia Destra */}
              <div className="grid grid-cols-5 gap-1 sm:gap-1.5 w-full justify-items-center pl-1 sm:pl-2">
                {PEDANA_SINISTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => 
                  renderBedCell(bedNum, `ps-right-${bedNum || "null"}-${idx}`)
                )}
              </div>
            </div>
          </div>
        </div>

        {/* PEDANA DESTRA */}
        <div id="pedana-destra" className="flex flex-col items-center p-3 sm:p-5 bg-[#FDFBF7] rounded-3xl border border-[#EFECE6] shadow-sm shadow-[#F3EFE6] w-full overflow-hidden">
          <h3 className="text-xs sm:text-sm font-extrabold text-[#025A70] mb-4 tracking-wider uppercase">Pedana Destra</h3>
          <div className="w-full overflow-x-auto pb-2 scrollbar-thin">
            <div className={`grid grid-cols-[5fr_6fr] gap-2 sm:gap-4 w-full ${isClientView ? "" : "min-w-[640px] md:min-w-full"}`}>
              {/* Griglia Sinistra */}
              <div className="grid grid-cols-5 gap-1 sm:gap-1.5 w-full justify-items-center pr-2 sm:pr-4 border-r border-[#EFECE6]">
                {PEDANA_DESTRA_LEFT.flatMap((row) => row).map((bedNum, idx) => 
                  renderBedCell(bedNum, `pd-left-${bedNum || "null"}-${idx}`)
                )}
              </div>

              {/* Griglia Destra */}
              <div className="grid grid-cols-6 gap-1 sm:gap-1.5 w-full justify-items-center pl-1 sm:pl-2">
                {PEDANA_DESTRA_RIGHT.flatMap((row) => row).map((bedNum, idx) => 
                  renderBedCell(bedNum, `pd-right-${bedNum || "null"}-${idx}`)
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
