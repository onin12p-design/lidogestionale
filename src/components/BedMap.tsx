import React from "react";
import { Booking, Tab, Payment, BOOKING_TYPE_COLORS, BookingTipoPrenotazione } from "../types";
import { Coffee, CheckCircle, AlertCircle, HelpCircle } from "lucide-react";
import { getPriceForBooking, getBedLettiniCount, getBedItems, getBookingPriceProportional } from "../utils";

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
  availability?: { bedNumber: number; status: "free" | "morning_free" | "afternoon_free" | "partial" | "full" }[];
  pricingConfigs?: any[];
  bedsConfig?: Record<number, number>;
  rowsConfig?: Record<number, number>;
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
  pricingConfigs = [],
  bedsConfig = {},
  rowsConfig = {}
}: BedMapProps) {
  
  // Helper to get visual status and bookings details for a bed number
  const getBedVisualStatus = (bedNum: number) => {
    const numLettini = getBedLettiniCount(bedNum, bedsConfig);
    const totalItems = numLettini + 1; // ombrellone + lettini
    const allPossibleItems = getBedItems(bedNum, numLettini);

    if (isClientView) {
      const found = availability.find((a) => a.bedNumber === bedNum) as any;
      const status = found ? found.status : "free";
      const occupiedCount = found && found.occupiedCount !== undefined ? found.occupiedCount : (status === "full" ? totalItems : (status === "free" ? 0 : 1));
      const totItems = found && found.totalItems !== undefined ? found.totalItems : totalItems;

      let style: React.CSSProperties = {};
      if (status === "full") {
        style = { backgroundColor: "rgba(243, 239, 230, 0.8)" };
      } else if (status === "morning_free") {
        style = {
          background: `linear-gradient(0deg, rgba(243, 239, 230, 0.8) 50%, #EAF4F6 50%)`
        };
      } else if (status === "afternoon_free") {
        style = {
          background: `linear-gradient(180deg, rgba(243, 239, 230, 0.8) 50%, #EAF4F6 50%)`
        };
      } else if (status === "partial") {
        style = {
          background: "repeating-linear-gradient(45deg, rgba(243,239,230,0.9) 0 5px, #EAF4F6 5px 10px)"
        };
      } else {
        style = { backgroundColor: "#EAF4F6" };
      }

      return {
        state: status,
        isSubscriber: false,
        bookingsOnBed: [],
        occupiedCount,
        totalItems: totItems,
        style
      };
    }

    // Find all bookings for this bed on this day
    const bedBookings = bookings.filter((b) => {
      if (b.risorse && b.risorse.length > 0) {
        return b.risorse.some((r) => r.postazione === bedNum);
      }
      return b.bedNumber === bedNum;
    });

    if (bedBookings.length === 0) {
      return {
        state: "free",
        isSubscriber: false,
        bookingsOnBed: [],
        occupiedCount: 0,
        totalItems,
        style: { backgroundColor: BOOKING_TYPE_COLORS.free }
      };
    }

    // Check which items are occupied for morning and afternoon
    const morningOccupied = new Set<string>();
    const afternoonOccupied = new Set<string>();
    const isSubscriber = bedBookings.some((b) => b.customerType === "subscriber");

    bedBookings.forEach((b) => {
      // Resolve occupied items for this booking on this bed
      let occupiedItems: string[] = [];
      if (b.risorse && b.risorse.length > 0) {
        const res = b.risorse.find((r) => r.postazione === bedNum);
        if (res) occupiedItems = res.items;
      } else {
        // Legacy fallback: occupies all items
        occupiedItems = allPossibleItems;
      }

      if (b.slot === "morning") {
        occupiedItems.forEach(item => morningOccupied.add(item));
      } else if (b.slot === "afternoon") {
        occupiedItems.forEach(item => afternoonOccupied.add(item));
      } else if (b.slot === "full_day") {
        occupiedItems.forEach(item => {
          morningOccupied.add(item);
          afternoonOccupied.add(item);
        });
      }
    });

    // Find unique items occupied at any point in the day
    const uniqueOccupied = new Set<string>([...morningOccupied, ...afternoonOccupied]);
    const occupiedCount = uniqueOccupied.size;

    // Determine visual types
    const morningBookings = bedBookings.filter(b => b.slot === "morning" || b.slot === "full_day");
    const afternoonBookings = bedBookings.filter(b => b.slot === "afternoon" || b.slot === "full_day");

    // Resolve colors
    const getBookingColor = (bList: Booking[]) => {
      if (bList.length === 0) return null;
      // Find highest priority type: abbonato > intera > mattina/pomeriggio
      const hasSubscriber = bList.some(b => b.customerType === "subscriber" || b.tipoPrenotazione === "abbonato");
      if (hasSubscriber) return BOOKING_TYPE_COLORS.abbonato;

      const types = bList.map(b => b.tipoPrenotazione).filter(Boolean);
      if (types.includes("abbonato")) return BOOKING_TYPE_COLORS.abbonato;
      if (types.includes("intera")) return BOOKING_TYPE_COLORS.intera;
      if (types.includes("pomeriggio")) return BOOKING_TYPE_COLORS.pomeriggio;
      if (types.includes("mattina")) return BOOKING_TYPE_COLORS.mattina;

      // Fallback from slot
      const slots = bList.map(b => b.slot);
      if (slots.includes("full_day")) return BOOKING_TYPE_COLORS.intera;
      if (slots.includes("morning")) return BOOKING_TYPE_COLORS.mattina;
      if (slots.includes("afternoon")) return BOOKING_TYPE_COLORS.pomeriggio;

      return BOOKING_TYPE_COLORS.intera;
    };

    const morningColor = getBookingColor(morningBookings);
    const afternoonColor = getBookingColor(afternoonBookings);

    let style: React.CSSProperties = {};
    let stateLabel = "free";

    if (morningColor && afternoonColor && morningColor !== afternoonColor) {
      // Diagonal split!
      style = {
        background: `linear-gradient(135deg, ${morningColor} 50%, ${afternoonColor} 50%)`
      };
      stateLabel = "split_full_day";
    } else if (morningColor && afternoonColor) {
      style = { backgroundColor: morningColor };
      stateLabel = "full_day";
    } else if (morningColor) {
      style = {
        background: `linear-gradient(180deg, ${morningColor} 50%, ${BOOKING_TYPE_COLORS.free} 50%)`
      };
      stateLabel = "morning";
    } else if (afternoonColor) {
      style = {
        background: `linear-gradient(0deg, ${afternoonColor} 50%, ${BOOKING_TYPE_COLORS.free} 50%)`
      };
      stateLabel = "afternoon";
    } else {
      style = { backgroundColor: BOOKING_TYPE_COLORS.free };
      stateLabel = "free";
    }

    if (occupiedCount > 0 && occupiedCount < totalItems) {
      const baseBg = style.background || style.backgroundColor || BOOKING_TYPE_COLORS.free;
      style = {
        background: `repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 4px, transparent 4px 9px), ${baseBg}`
      };
    }

    return {
      state: stateLabel,
      isSubscriber,
      bookingsOnBed: bedBookings,
      occupiedCount,
      totalItems,
      style
    };
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

      expectedPrice += getBookingPriceProportional(booking, pricingConfigs, bedsConfig, rowsConfig);
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

    const { state, isSubscriber, bookingsOnBed, occupiedCount, totalItems, style } = getBedVisualStatus(bedNum);
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
      } else {
        bgClass = "border-slate-300 hover:border-slate-500 shadow-sm";
        textClass = "text-slate-800 font-extrabold";
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

    const isPartial = occupiedCount > 0 && occupiedCount < totalItems;

    return (
      <button
        key={key}
        id={`btn-bed-${bedNum}`}
        onClick={() => !isClientView && onBedSelect && onBedSelect(bedNum)}
        disabled={isClientView}
        title={tooltipTitle}
        style={state !== "free" ? style : undefined}
        className={`border rounded-md md:rounded-lg flex flex-col items-center justify-between relative transition-all duration-150 ${btnSizeClass} ${bgClass} ${textClass} ${selectedClass}`}
      >
        {/* Top section: Bed Number */}
        <div className="w-full text-center pt-0.5 sm:pt-1 relative">
          <span className="text-[10px] sm:text-xs md:text-sm font-extrabold leading-none">{bedNum}</span>
          
          {/* Small badge for subscriber */}
          {!isClientView && isSubscriber && state !== "free" && (
            <span className="absolute top-0 right-0.5 w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-[#8A6D3B] shrink-0" title="Abbonato" />
          )}

          {/* Partial Occupancy Badge */}
          {isPartial && (
            <span className="absolute top-0 left-0.5 bg-slate-900 text-white font-black text-[8px] sm:text-[9px] px-1 py-0.5 rounded-full shrink-0 shadow-sm leading-none" title={`Sotto-risorse occupate: ${occupiedCount}/${totalItems}`}>
              {occupiedCount}/{totalItems}
            </span>
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
            <div className="w-4 h-4 border border-slate-300 rounded animate-none" style={{ backgroundColor: BOOKING_TYPE_COLORS.free }}></div>
            <span>Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 border border-slate-300 rounded" style={{ backgroundColor: BOOKING_TYPE_COLORS.mattina }}></div>
            <span>Mattina (AM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 border border-slate-300 rounded" style={{ backgroundColor: BOOKING_TYPE_COLORS.pomeriggio }}></div>
            <span>Pomeriggio (PM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 border border-slate-300 rounded" style={{ backgroundColor: BOOKING_TYPE_COLORS.intera }}></div>
            <span>Giornata Intera (Full)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 border border-slate-300 rounded" style={{ backgroundColor: BOOKING_TYPE_COLORS.abbonato }}></div>
            <span>Abbonato</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 border border-slate-300 rounded" style={{ background: `linear-gradient(135deg, ${BOOKING_TYPE_COLORS.mattina} 50%, ${BOOKING_TYPE_COLORS.pomeriggio} 50%)` }}></div>
            <span>AM + PM (Split)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-8 h-4 bg-slate-900 text-white text-[8px] font-black rounded flex items-center justify-center shadow-sm">1/3</div>
            <span>Parzialmente Occupato</span>
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
