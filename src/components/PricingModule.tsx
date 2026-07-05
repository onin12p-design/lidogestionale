import React, { useState, useEffect } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { sanitizeForFirestore } from "../utils";
import { Save, RefreshCw, CheckCircle, Info, Calendar, DollarSign, Layers } from "lucide-react";
import { motion } from "motion/react";

interface PricingModuleProps {
  pricingConfigs: any[];
}

export const DEFAULT_PRICES: Record<string, Record<number, { fullDay: number; halfDay: number }>> = {
  "05": { // Maggio
    1: { fullDay: 25, halfDay: 15 },
    2: { fullDay: 20, halfDay: 12 },
    3: { fullDay: 18, halfDay: 10 },
    4: { fullDay: 15, halfDay: 9 },
    5: { fullDay: 15, halfDay: 9 }
  },
  "06": { // Giugno
    1: { fullDay: 30, halfDay: 18 },
    2: { fullDay: 25, halfDay: 15 },
    3: { fullDay: 22, halfDay: 13 },
    4: { fullDay: 20, halfDay: 12 },
    5: { fullDay: 18, halfDay: 10 }
  },
  "07": { // Luglio
    1: { fullDay: 35, halfDay: 20 },
    2: { fullDay: 30, halfDay: 18 },
    3: { fullDay: 25, halfDay: 15 },
    4: { fullDay: 22, halfDay: 13 },
    5: { fullDay: 20, halfDay: 12 }
  },
  "08": { // Agosto
    1: { fullDay: 40, halfDay: 25 },
    2: { fullDay: 35, halfDay: 20 },
    3: { fullDay: 30, halfDay: 18 },
    4: { fullDay: 25, halfDay: 15 },
    5: { fullDay: 22, halfDay: 13 }
  },
  "09": { // Settembre
    1: { fullDay: 25, halfDay: 15 },
    2: { fullDay: 20, halfDay: 12 },
    3: { fullDay: 18, halfDay: 10 },
    4: { fullDay: 15, halfDay: 9 },
    5: { fullDay: 15, halfDay: 9 }
  }
};

const MONTHS_LIST = [
  { id: "05", name: "Maggio" },
  { id: "06", name: "Giugno" },
  { id: "07", name: "Luglio" },
  { id: "08", name: "Agosto" },
  { id: "09", name: "Settembre" }
];

export default function PricingModule({ pricingConfigs }: PricingModuleProps) {
  const [activeMonthId, setActiveMonthId] = useState<string>("07"); // Default July
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Current editable prices state
  const [pricesState, setPricesState] = useState<Record<number, { fullDay: number; halfDay: number }>>({
    1: { fullDay: 30, halfDay: 18 },
    2: { fullDay: 25, halfDay: 15 },
    3: { fullDay: 22, halfDay: 13 },
    4: { fullDay: 20, halfDay: 12 },
    5: { fullDay: 18, halfDay: 10 }
  });

  // Sync state when activeMonthId or pricingConfigs change
  useEffect(() => {
    const customConfig = pricingConfigs.find((c) => c.id === activeMonthId);
    if (customConfig && customConfig.prices) {
      const merged: any = {};
      [1, 2, 3, 4, 5].forEach((rowNum) => {
        merged[rowNum] = {
          fullDay: customConfig.prices[rowNum]?.fullDay ?? 30,
          halfDay: customConfig.prices[rowNum]?.halfDay ?? 15
        };
      });
      setPricesState(merged);
    } else {
      // Fallback to default month price
      const defaultMonth = DEFAULT_PRICES[activeMonthId] || DEFAULT_PRICES["06"];
      setPricesState(JSON.parse(JSON.stringify(defaultMonth)));
    }
  }, [activeMonthId, pricingConfigs]);

  const handlePriceChange = (row: number, type: "fullDay" | "halfDay", val: string) => {
    const parsed = parseFloat(val) || 0;
    setPricesState((prev) => ({
      ...prev,
      [row]: {
        ...prev[row],
        [type]: parsed
      }
    }));
  };

  const handleSavePrices = async () => {
    setSaving(true);
    setSuccessMsg(null);
    try {
      const activeMonthName = MONTHS_LIST.find((m) => m.id === activeMonthId)?.name || "";
      const pricingRef = doc(db, "pricing", activeMonthId);

      await setDoc(pricingRef, sanitizeForFirestore({
        monthId: activeMonthId,
        monthName: activeMonthName,
        prices: pricesState
      }));

      setSuccessMsg(`Prezzi di ${activeMonthName} salvati con successo!`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      console.error("Error saving pricing configs:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = () => {
    const defaultPrices = DEFAULT_PRICES[activeMonthId];
    if (defaultPrices) {
      setPricesState(JSON.parse(JSON.stringify(defaultPrices)));
      setSuccessMsg("Prezzi di default ripristinati per questo mese! (Fai clic su Salva per applicare)");
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  return (
    <div id="pricing-module-root" className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
      {/* LEFT MONTH SELECTOR COLUMN */}
      <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-[#025A70] font-bold mb-2">
          <Calendar className="w-5 h-5" />
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800">Seleziona Mese</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          I prezzi variano in base alla stagione ed al mese selezionato. Configura i prezzi per ciascun mese della stagione.
        </p>
        <div className="flex flex-col gap-1.5">
          {MONTHS_LIST.map((m) => {
            const isActive = activeMonthId === m.id;
            return (
              <button
                key={m.id}
                id={`btn-pricing-month-${m.id}`}
                onClick={() => {
                  setActiveMonthId(m.id);
                  setSuccessMsg(null);
                }}
                className={`w-full py-2.5 px-4 text-left font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-between ${
                  isActive
                    ? "bg-[#025A70] text-white shadow-md shadow-[#025A70]/10"
                    : "text-slate-600 hover:text-[#025A70] hover:bg-slate-50 border border-transparent hover:border-slate-200"
                }`}
              >
                <span>{m.name}</span>
                <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                  isActive ? "bg-slate-800/30 text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {m.id}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT EDIT PRICE FORM COLUMN */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-50 text-[#025A70] mb-1.5">
              Configurazione Tariffe
            </span>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight leading-tight">
              Prezzi per il mese di {MONTHS_LIST.find((m) => m.id === activeMonthId)?.name}
            </h2>
          </div>
          
          <button
            id="btn-pricing-restore-defaults"
            onClick={handleRestoreDefaults}
            className="px-3.5 py-2 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Prezzi Standard</span>
          </button>
        </div>

        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            id="pricing-success-banner"
            className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs font-bold text-emerald-800 flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </motion.div>
        )}

        {/* INPUT TABLE BY ROWS (1 to 5) */}
        <div className="space-y-4">
          <div className="grid grid-cols-12 gap-4 px-4 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-2">
            <div className="col-span-4 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Fila / Settore</div>
            <div className="col-span-4 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Giornata Intera</div>
            <div className="col-span-4 flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-slate-400" /> Mezza Giornata</div>
          </div>

          {[1, 2, 3, 4, 5].map((rowNum) => {
            const rowPrices = pricesState[rowNum] || { fullDay: 30, halfDay: 15 };
            return (
              <div
                key={rowNum}
                className="grid grid-cols-12 gap-4 items-center bg-slate-50/50 hover:bg-slate-50/80 p-3 sm:p-4 rounded-2xl border border-slate-100/60 transition-colors"
              >
                <div className="col-span-4">
                  <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 flex items-center gap-2">
                    <span className="w-6 h-6 bg-[#025A70]/10 text-[#025A70] rounded-lg flex items-center justify-center text-xs font-black">
                      {rowNum}
                    </span>
                    <span>{rowNum === 1 ? "1ª Fila" : `${rowNum}ª Fila`}</span>
                  </h4>
                  <span className="text-[10px] text-slate-400 font-medium block ml-8">
                    {rowNum === 1 ? "La più vicina al mare" : `Row ${rowNum} rows`}
                  </span>
                </div>

                {/* Giornata Intera Input */}
                <div className="col-span-4 relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">€</span>
                  <input
                    id={`input-price-row-${rowNum}-full`}
                    type="number"
                    min="1"
                    max="500"
                    step="0.50"
                    value={rowPrices.fullDay}
                    onChange={(e) => handlePriceChange(rowNum, "fullDay", e.target.value)}
                    className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#025A70] focus:border-transparent shadow-sm"
                    placeholder="30"
                  />
                </div>

                {/* Mezza Giornata Input */}
                <div className="col-span-4 relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">€</span>
                  <input
                    id={`input-price-row-${rowNum}-half`}
                    type="number"
                    min="1"
                    max="500"
                    step="0.50"
                    value={rowPrices.halfDay}
                    onChange={(e) => handlePriceChange(rowNum, "halfDay", e.target.value)}
                    className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#025A70] focus:border-transparent shadow-sm"
                    placeholder="15"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-[#EAF4F6] rounded-2xl p-4 flex gap-3 text-[#025A70] border border-[#025A70]/10">
          <Info className="w-5 h-5 shrink-0 mt-0.5 text-[#025A70]" />
          <div className="space-y-1">
            <h5 className="text-xs font-black uppercase tracking-wider">Applicazione Automatica</h5>
            <p className="text-[11px] font-medium leading-relaxed">
              Questi prezzi modificati saranno applicati <strong>immediatamente</strong> in tempo reale a tutte le prenotazioni del mese corrente. Quando crei una prenotazione o verifichi se è stata pagata, l'app calcolerà i prezzi direttamente in base a questa griglia personalizzata.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end pt-3 border-t border-slate-100">
          <button
            id="btn-pricing-save-submit"
            onClick={handleSavePrices}
            disabled={saving}
            className="px-6 py-2.5 bg-[#025A70] hover:bg-[#014152] active:bg-[#01313d] text-white font-bold rounded-xl shadow-lg shadow-[#025A70]/10 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs sm:text-sm"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Salvataggio in corso...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Salva Tariffe di {MONTHS_LIST.find((m) => m.id === activeMonthId)?.name}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
