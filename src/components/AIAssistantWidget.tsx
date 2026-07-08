import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, X, Send, Sparkles, Loader2, Edit3, Check, Trash2 } from "lucide-react";
import { runTransaction, db, collection, doc, query, where, getDocs, onSnapshot, setDoc, deleteDoc } from "../lib/firebase";

interface ProposalData {
  type: "subscription" | "daily_map";
  id: string;
  data: any;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  proposals?: ProposalData[];
}

export default function AIAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  
  // Floating Badge indicator (shows if there is any proposals or messages)
  const [unreadCount, setUnreadCount] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize Session ID
  useEffect(() => {
    let savedSessionId = localStorage.getItem("samarinda_ai_session_id");
    if (!savedSessionId) {
      savedSessionId = `session_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem("samarinda_ai_session_id", savedSessionId);
    }
    setSessionId(savedSessionId);
  }, []);

  // Sync Messages from Firestore in Real-Time
  useEffect(() => {
    if (!sessionId) return;

    const msgsRef = collection(db, `assistantSessions/${sessionId}/messages`);
    const unsubscribe = onSnapshot(msgsRef, (snapshot) => {
      const list: Message[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Message);
      });
      list.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
      setMessages(list);

      // Increment badge count if closed and new messages arrived
      if (!isOpen && list.length > 0) {
        setUnreadCount(prev => prev + 1);
      }
    });

    return unsubscribe;
  }, [sessionId, isOpen]);

  // Auto Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleOpenToggle = () => {
    setIsOpen(!isOpen);
    setUnreadCount(0);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const currentText = input;
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentText, sessionId })
      });

      const data = await res.json();
      if (!data.success) {
        console.error("AI assistant returned error:", data.error);
      }
    } catch (err) {
      console.error("AI Assistant network error:", err);
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearSession = async () => {
    if (!window.confirm("Sei sicuro di voler cancellare la cronologia della chat?")) return;
    
    try {
      const msgsRef = collection(db, `assistantSessions/${sessionId}/messages`);
      const snapshot = (await getDocs(msgsRef)) as any;
      const deletePromises: Promise<void>[] = [];
      snapshot.forEach((docSnap: any) => {
        deletePromises.push(deleteDoc(doc(db, `assistantSessions/${sessionId}/messages/${docSnap.id}`)));
      });
      await Promise.all(deletePromises);
      setMessages([]);
    } catch (err) {
      console.error("Error clearing chat history:", err);
    }
  };

  return (
    <div id="ai-assistant-wrapper" className="fixed bottom-6 right-6 z-50 font-sans">
      
      {/* 1. FLOATING LAUNCHER BADGE */}
      {!isOpen && (
        <button
          id="btn-ai-launcher"
          onClick={handleOpenToggle}
          className="relative flex items-center gap-2 px-5 py-3.5 bg-gradient-to-r from-[#025A70] to-[#014152] hover:from-[#014152] hover:to-[#01313d] text-white font-bold rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95 duration-200 cursor-pointer text-xs"
        >
          <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
          <span>Chiedi all'Assistente</span>
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-500 text-slate-900 font-extrabold text-[10px] rounded-full flex items-center justify-center animate-bounce border-2 border-white shadow-sm">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* 2. COLLAPSED FLOATING CHAT PANEL */}
      {isOpen && (
        <div
          id="ai-chat-panel"
          className="w-[420px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] bg-white border border-slate-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200"
        >
          {/* Header */}
          <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <div className="bg-[#025A70] p-1.5 rounded-lg text-white shadow-md">
                <Sparkles className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h3 className="text-xs font-black tracking-tight uppercase">Assistente AI</h3>
                <span className="text-[9px] text-slate-400 font-mono block">Lido Samarinda Fine Beach</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                id="btn-ai-clear-chat"
                onClick={handleClearSession}
                title="Cancella conversazione"
                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                id="btn-ai-close"
                onClick={handleOpenToggle}
                className="p-1.5 hover:bg-rose-600/30 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                <div className="w-12 h-12 bg-[#EAF4F6] text-[#025A70] rounded-2xl flex items-center justify-center shadow-inner">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                </div>
                <h4 className="text-xs font-bold text-slate-700">Come posso aiutarti oggi?</h4>
                <p className="text-[10px] text-slate-400 max-w-[240px] leading-relaxed">
                  Puoi chiedermi di verificare le presenze storiche di un cliente, analizzare lo storico di un lettino, o preparare schede abbonamenti ed inserimenti rapidi sulla mappa.
                </p>
                <div className="grid grid-cols-1 gap-1.5 w-full max-w-[280px] pt-2">
                  {[
                    "Chi c'era al lettino 15 il 04 luglio 2026?",
                    "Cerca abbonamenti a nome Bianchi",
                    "Proponi abbonamento per Rossi lettino 12 dal 1 luglio al 15 luglio"
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion)}
                      className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-medium text-slate-600 text-left transition-colors truncate shadow-sm cursor-pointer"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {/* Chat bubble */}
                  <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                        m.role === "user"
                          ? "bg-[#025A70] text-white rounded-br-none"
                          : "bg-white border border-slate-200 text-slate-800 rounded-bl-none whitespace-pre-wrap"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>

                  {/* Render proposals if any */}
                  {m.role === "assistant" && m.proposals && m.proposals.map((prop, index) => (
                    <ProposalCard key={index} proposal={prop} />
                  ))}
                </div>
              ))
            )}

            {isTyping && (
              <div className="flex justify-start items-center gap-1 bg-white border border-slate-100 rounded-xl px-4 py-2.5 shadow-sm text-[10px] font-bold text-[#025A70] w-max">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>L'Assistente sta elaborando...</span>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* Input field */}
          <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 bg-white flex gap-2 items-center shrink-0">
            <input
              id="input-ai-text"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Fai una domanda all'assistente..."
              className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#025A70] transition-all"
            />
            <button
              id="btn-ai-send"
              type="submit"
              className="p-2.5 bg-[#025A70] hover:bg-[#014152] text-white rounded-xl shadow-md transition-all flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ==========================================
   PROPOSAL CARDS COMPONENT
   ========================================== */
function ProposalCard({ proposal }: { proposal: any; key?: any }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Editable Form states
  const [formData, setFormData] = useState<any>({ ...proposal.data });

  const handleFieldChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleBedNumbersChange = (text: string) => {
    const beds = text.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    handleFieldChange("bedNumbers", beds);
  };

  // 1. CONFIRM SUBSCRIPTION PROPOSAL
  const confirmSubscription = async () => {
    setSubmitting(true);
    setStatusText(null);

    try {
      await runTransaction(db, async (tx) => {
        // Step A: Find or Create Customer
        const customerRef = collection(db, "customers");
        const queryCust = query(customerRef, where("name", "==", formData.customerName.trim()));
        const custSnap = (await getDocs(queryCust)) as any;
        
        let customerId = "";
        if (!custSnap.empty) {
          customerId = custSnap.docs[0].id;
        } else {
          // Generate new customer id
          const newId = `customer_${Math.random().toString(36).substring(2, 11)}`;
          const newCustDoc = doc(db, `customers/${newId}`);
          customerId = newId;
          tx.set(newCustDoc, {
            name: formData.customerName.trim(),
            phone: "",
            type: "subscriber",
            notes: "Creato automaticamente dall'Assistente AI"
          });
        }

        // Step B: Set the Subscription
        const subId = `sub_${Date.now()}`;
        const subDocRef = doc(db, "subscriptions", subId);
        
        const firstPeriod = formData.periods?.[0] || { startDate: "2026-06-01", endDate: "2026-09-15" };
        const price = Number(formData.priceTotal) || 0;

        tx.set(subDocRef, {
          customerId,
          bedNumbers: formData.bedNumbers,
          startDate: firstPeriod.startDate,
          endDate: firstPeriod.endDate,
          slot: "full_day",
          priceTotal: price,
          status: "active",
          createdAt: new Date().toISOString(),
          notes: formData.notes || ""
        });

        // Step C: Generate Bookings inside transaction (CRITICAL WRITE REQUIREMENT)
        for (const period of formData.periods || []) {
          const start = new Date(period.startDate);
          const end = new Date(period.endDate);
          
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            
            for (const bed of formData.bedNumbers) {
              const bookingId = `${dateStr}_${bed}_full_day`;
              const bookingRef = doc(db, "bookings", bookingId);
              
              tx.set(bookingRef, {
                bedNumber: bed,
                date: dateStr,
                slot: "full_day",
                tipoPrenotazione: "abbonato",
                customerId,
                customerName: formData.customerName,
                customerType: "subscriber",
                subscriptionId: subId,
                source: "scanner",
                notes: "Abbonamento registrato via AI",
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      });

      setIsConfirmed(true);
      setStatusText("Abbonamento e prenotazioni confermati correttamente in Firestore!");
    } catch (err: any) {
      console.error("Subscription transaction error:", err);
      setStatusText(`Errore di transazione: ${err.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 2. CONFIRM DAILY MAP ENTRY PROPOSAL
  const confirmDailyMap = async () => {
    setSubmitting(true);
    setStatusText(null);

    try {
      await runTransaction(db, async (tx) => {
        const bookingId = `${formData.date}_${formData.bedNumber}_${formData.slot}`;
        const bookingRef = doc(db, `bookings/${bookingId}`);

        tx.set(bookingRef, {
          bedNumber: Number(formData.bedNumber),
          date: formData.date,
          slot: formData.slot,
          tipoPrenotazione: formData.tipoPrenotazione,
          customerName: formData.customerName,
          customerType: "daily",
          source: "scanner",
          notes: formData.notes || "Inserito via AI",
          createdAt: new Date().toISOString()
        });
      });

      setIsConfirmed(true);
      setStatusText("Prenotazione giornaliera inserita correttamente!");
    } catch (err: any) {
      console.error("Daily booking transaction error:", err);
      setStatusText(`Errore di transazione: ${err.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-amber-50/50 to-white border border-amber-200 rounded-2xl p-4 shadow-md space-y-3 max-w-[90%] mx-auto font-sans text-slate-800">
      
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-amber-100">
        <div className="flex items-center gap-1.5 text-amber-700 font-extrabold text-xs">
          <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{proposal.type === "subscription" ? "Proposta d'Abbonamento" : "Proposta Prenotazione"}</span>
        </div>
        {!isConfirmed && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-amber-100 text-[10px] font-bold text-amber-700 rounded-lg transition-colors cursor-pointer"
          >
            <Edit3 className="w-3 h-3" />
            <span>{isEditing ? "Chiudi Modifica" : "Modifica"}</span>
          </button>
        )}
      </div>

      {/* RENDER FORM / VIEW */}
      <div className="text-[11px] space-y-2 leading-relaxed">
        {isEditing ? (
          <div className="space-y-2.5">
            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase">Cliente</label>
              <input
                type="text"
                value={formData.customerName}
                onChange={(e) => handleFieldChange("customerName", e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px]"
              />
            </div>

            {proposal.type === "subscription" ? (
              <>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase">Lettini Assegnati (separati da virgola)</label>
                  <input
                    type="text"
                    value={formData.bedNumbers?.join(", ")}
                    onChange={(e) => handleBedNumbersChange(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase">Prezzo Proposto (€)</label>
                  <input
                    type="number"
                    value={formData.priceTotal || ""}
                    onChange={(e) => handleFieldChange("priceTotal", e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px]"
                  />
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase">Data</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleFieldChange("date", e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px]"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase">Lettino</label>
                  <input
                    type="number"
                    value={formData.bedNumber}
                    onChange={(e) => handleFieldChange("bedNumber", parseInt(e.target.value))}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase">Note</label>
              <textarea
                value={formData.notes || ""}
                onChange={(e) => handleFieldChange("notes", e.target.value)}
                rows={2}
                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px]"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p><strong>Cliente:</strong> {formData.customerName}</p>
            {proposal.type === "subscription" ? (
              <>
                <p><strong>Lettini:</strong> {formData.bedNumbers?.join(", ")}</p>
                <p><strong>Prezzo Proposto:</strong> {formData.priceTotal ? `€ ${formData.priceTotal}` : "Da listino"}</p>
                <p><strong>Periodo:</strong> {formData.periods?.map((p: any, i: number) => (
                  <span key={i} className="block pl-2 text-slate-500">
                    • {p.label || "Periodo"}: {p.startDate} al {p.endDate}
                  </span>
                ))}</p>
              </>
            ) : (
              <>
                <p><strong>Lettino:</strong> {formData.bedNumber} ({formData.platform?.toUpperCase()})</p>
                <p><strong>Data:</strong> {formData.date}</p>
                <p><strong>Slot:</strong> {formData.slot === "full_day" ? "Giornata Intera" : formData.slot === "morning" ? "Mattina" : "Pomeriggio"}</p>
              </>
            )}
            {formData.notes && <p><strong>Note:</strong> <span className="text-slate-500 italic">{formData.notes}</span></p>}
          </div>
        )}
      </div>

      {/* ACTION BUTTONS */}
      {!isConfirmed ? (
        <button
          onClick={proposal.type === "subscription" ? confirmSubscription : confirmDailyMap}
          disabled={submitting}
          className="w-full py-2.5 bg-[#025A70] hover:bg-[#014152] disabled:bg-slate-300 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          <span>{submitting ? "Inserimento..." : "Conferma e Salva in Firestore"}</span>
        </button>
      ) : (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center text-[10px] font-bold text-emerald-800 flex items-center justify-center gap-1">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Inserito con successo via Transazione!</span>
        </div>
      )}

      {statusText && (
        <p className={`text-[10px] text-center font-semibold ${isConfirmed ? "text-emerald-700" : "text-rose-700"}`}>
          {statusText}
        </p>
      )}

    </div>
  );
}
