import React, { useState, useEffect } from "react";
import { getRomeTodayString, adjustDateString, formatItalianDate } from "../utils";
import BedMap from "./BedMap";
import { Phone, MessageCircle, Calendar, RefreshCw, Sun, Clock, HelpCircle } from "lucide-react";

export default function ClientView() {
  const [clientDate, setClientDate] = useState("");
  const [availability, setAvailability] = useState<{ bedNumber: number; status: "free" | "morning_free" | "afternoon_free" | "full" }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Constraints for date selector (today to today + 60 days) (C)
  const todayStr = getRomeTodayString();
  const maxDateStr = adjustDateString(todayStr, 60);

  useEffect(() => {
    setClientDate(todayStr);
  }, []);

  useEffect(() => {
    if (!clientDate) return;

    setLoading(true);
    setError(null);

    // Call server API securely instead of Firestore directly (C - Secure client data access)
    fetch(`/api/availability?date=${clientDate}`)
      .then(async (res) => {
        if (!res.ok) {
          try {
            const errData = await res.json();
            throw new Error(errData.error || "Errore nel caricamento della disponibilità.");
          } catch (e) {
            throw new Error("Errore nel caricamento della disponibilità.");
          }
        }
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailability(data);
        } else {
          setAvailability([]);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Client fetch error:", err);
        setError(err.message || "Servizio momentaneamente non disponibile. Riprova più tardi.");
        setLoading(false);
      });
  }, [clientDate]);

  // Statistics counts based on availability
  const totalBeds = availability.length || 84;
  const fullBedsCount = availability.filter((a) => a.status === "full").length;
  const partialBedsCount = availability.filter((a) => a.status === "morning_free" || a.status === "afternoon_free").length;
  const freeBedsCount = totalBeds - fullBedsCount; // Any bed that has some vacancy is counted as free or partly free

  return (
    <div id="client-view-root" className="min-h-screen bg-[#FDFBF7] flex flex-col font-sans select-none antialiased">
      
      {/* Client Header */}
      <header className="bg-slate-900 text-white px-4 py-6 shadow-md border-b-4 border-[#F2A104]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <h1 className="text-2xl font-black tracking-tight uppercase flex items-center justify-center md:justify-start gap-2 text-white">
              <Sun className="w-7 h-7 text-[#F2A104] animate-spin-slow" />
              Samarinda Fine Beach
            </h1>
            <p className="text-xs text-[#B3D5DC] font-mono tracking-widest uppercase mt-1">Disponibilità Lettini • Santa Maria di Leuca</p>
          </div>
          
          {/* Booking Contacts (C) */}
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              id="link-call-phone"
              href="tel:+390833758657"
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#025A70] hover:bg-[#014152] text-white font-bold rounded-xl transition-all shadow-md text-sm cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              Chiama +39 0833 758657
            </a>
            <a
              id="link-whatsapp"
              href="https://wa.me/393456789101?text=Richiesta%20prenotazione%20lettini"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-md text-sm cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp +39 345 6789101
            </a>
          </div>
        </div>
      </header>

      {/* Main content body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {/* Date Selector and Stat Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          
          {/* 1. Date Selector Block */}
          <div className="bg-white p-5 rounded-2xl border border-[#EFECE6] shadow-sm shadow-[#F3EFE6] flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Calendar className="w-4 h-4 text-[#025A70]" />
                Seleziona Data
              </h2>
              <p className="text-xs text-slate-500 mb-4">Scegli la data per consultare lo stato in tempo reale (prenotazioni future max 60 giorni).</p>
            </div>
            
            <input
              id="client-date-picker"
              type="date"
              min={todayStr}
              max={maxDateStr}
              value={clientDate}
              onChange={(e) => setClientDate(e.target.value)}
              className="w-full px-4 py-3 bg-[#FDFBF7] border border-[#EFECE6] rounded-xl text-[#025A70] font-bold focus:outline-none focus:ring-2 focus:ring-[#025A70] transition-all cursor-pointer"
            />
          </div>

          {/* 2. Realtime State Block */}
          <div className="bg-white p-5 rounded-2xl border border-[#EFECE6] shadow-sm shadow-[#F3EFE6] flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Clock className="w-4 h-4 text-[#025A70]" />
                Aggiornato Ora
              </h2>
              <p className="text-xs text-slate-500 mb-4">La mappa sottostante mostra la reale occupazione per la data di riferimento.</p>
            </div>

            <div className="flex items-center justify-between border-t border-[#EFECE6] pt-3">
              <span className="text-xs font-bold text-slate-400">Data Selezionata:</span>
              <span className="text-sm font-black text-[#025A70] bg-[#EAF4F6] px-2.5 py-1 rounded-lg border border-[#B3D5DC]">
                {clientDate ? formatItalianDate(clientDate) : ""}
              </span>
            </div>
          </div>

          {/* 3. Availability Stats */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-sm flex flex-col justify-between border-l-4 border-[#F2A104]">
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Stato Generale</h2>
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 font-semibold uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                In tempo reale
              </span>
            </div>

            <div className="flex justify-between items-end mt-4">
              <div>
                <span className="text-3xl font-black text-[#F2A104] font-mono">{freeBedsCount}</span>
                <span className="text-xs text-slate-300 block font-semibold">Lettini Liberi</span>
              </div>
              <div className="text-right text-[10px] text-slate-400 font-semibold space-y-0.5">
                <div>Totale Stabilimento: <strong className="text-slate-200">84</strong></div>
                <div>Occupati Intero: <strong className="text-slate-200">{fullBedsCount}</strong></div>
                <div>Fasce Parziali: <strong className="text-slate-200">{partialBedsCount}</strong></div>
              </div>
            </div>
          </div>

        </div>

        {/* Legend block */}
        <div className="bg-white p-4 rounded-xl border border-[#EFECE6] shadow-sm shadow-[#F3EFE6] flex flex-wrap gap-4 items-center justify-center text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-[#EAF4F6] border border-[#B3D5DC] rounded"></span>
            <span className="font-semibold text-[#025A70]">Libero</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-gradient-to-t from-slate-100 via-white to-[#EAF4F6] border border-[#B3D5DC] rounded"></span>
            <span className="font-semibold text-[#025A70]">Mattina Libera (Pomeriggio Occupato)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-gradient-to-b from-[#EAF4F6] via-white to-slate-100 border border-[#B3D5DC] rounded"></span>
            <span className="font-semibold text-[#025A70]">Pomeriggio Libero (Mattina Occupata)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 bg-[#F3EFE6]/80 border border-[#E5DFD3] rounded"></span>
            <span className="font-semibold text-slate-500">Occupato Intero</span>
          </div>
        </div>

        {/* The Bed Map Stage */}
        <div className="bg-white rounded-3xl border border-[#EFECE6] p-6 shadow-sm shadow-[#F3EFE6] relative min-h-[400px]">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xs z-50 flex flex-col items-center justify-center rounded-3xl">
              <RefreshCw className="w-10 h-10 text-amber-500 animate-spin mb-2" />
              <p className="text-xs font-bold text-slate-600">Aggiornamento disponibilità lettini...</p>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl text-xs text-rose-700 font-bold mb-4">
              {error}
            </div>
          )}

          <div className="overflow-x-auto pb-4">
            <div className="min-w-[800px] flex justify-center">
              <BedMap isClientView={true} availability={availability} />
            </div>
          </div>
        </div>

      </main>

      {/* Client Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-6 text-center text-xs text-slate-500 px-4 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <span className="font-medium text-slate-400">© 2026 Lido Samarinda Fine Beach • Santa Maria di Leuca (LE)</span>
          <span className="font-mono text-[10px] text-[#F2A104]/90 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700/50">
            Per prenotazioni o abbonamenti stagionali si prega di telefonare o mandare un messaggio WhatsApp.
          </span>
        </div>
      </footer>

    </div>
  );
}
