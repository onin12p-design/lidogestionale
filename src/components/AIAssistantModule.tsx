import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Sparkles, Loader2, Edit3, Check, Trash2, Paperclip, FileText, Plus, AlertCircle, RefreshCw, X } from "lucide-react";
import { runTransaction, db, collection, doc, query, where, getDocs, onSnapshot, setDoc, deleteDoc } from "../lib/firebase";

interface ProposalData {
  type: "subscription" | "daily_map";
  id: string;
  data: any;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "model";
  content: string;
  timestamp: string;
  proposals?: ProposalData[];
  attachment?: {
    name: string;
    size: number;
    downloadUrl: string;
  };
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

export default function AIAssistantModule() {
  const [sessionId, setSessionId] = useState<string>("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 1. Load or initialize active Session ID, and listen to all sessions
  useEffect(() => {
    // Sync all sessions
    const sessionsRef = collection(db, "assistantSessions");
    const unsubscribeSessions = onSnapshot(sessionsRef, (snapshot) => {
      const list: ChatSession[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({ id: docSnap.id, title: data.title || "Conversazione", updatedAt: data.updatedAt || "" } as ChatSession);
      });
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setSessions(list);
      setLoadingSessions(false);

      // If no active session is selected but we have saved session, use that or create one
      let activeId = sessionId;
      if (!activeId) {
        activeId = localStorage.getItem("samarinda_ai_session_id") || "";
        if (activeId && list.some(s => s.id === activeId)) {
          setSessionId(activeId);
        } else if (list.length > 0) {
          setSessionId(list[0].id);
          localStorage.setItem("samarinda_ai_session_id", list[0].id);
        } else {
          // Create brand new session
          const newId = `session_${Math.random().toString(36).substring(2, 11)}`;
          setSessionId(newId);
          localStorage.setItem("samarinda_ai_session_id", newId);
        }
      }
    }, (err) => {
      console.error("Error fetching sessions:", err);
      setLoadingSessions(false);
    });

    return unsubscribeSessions;
  }, []);

  // 2. Sync Messages from Firestore in Real-Time for the active sessionId
  useEffect(() => {
    if (!sessionId) return;

    const msgsRef = collection(db, `assistantSessions/${sessionId}/messages`);
    const unsubscribe = onSnapshot(msgsRef, (snapshot) => {
      const list: Message[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // Convert 'model' role to 'assistant' so render styles match
        const role = data.role === "model" ? "assistant" : data.role;
        list.push({ id: docSnap.id, ...data, role } as Message);
      });
      list.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
      setMessages(list);
    }, (err) => {
      console.error("Error loading messages:", err);
    });

    return unsubscribe;
  }, [sessionId]);

  // Auto Scroll to bottom when messages or typing status changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleUploadFile = async (file: File) => {
    setIsUploading(true);
    setIsTyping(true);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ai-assistant/upload-and-ingest", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        // First ensure session document is updated/created
        await setDoc(doc(db, "assistantSessions", sessionId), {
          id: sessionId,
          title: `Import: ${file.name}`,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // Write the user message with attachment in Firestore
        const userMsgId = `user_${Date.now()}`;
        await setDoc(doc(db, `assistantSessions/${sessionId}/messages/${userMsgId}`), {
          role: "user",
          content: `Caricato file: ${file.name}`,
          attachment: {
            name: file.name,
            size: file.size,
            downloadUrl: data.file.downloadUrl
          },
          timestamp: new Date().toISOString()
        });

        const formatItalianDate = (dateStr: string) => {
          if (!dateStr) return "";
          const parts = dateStr.split("-");
          if (parts.length < 3) return dateStr;
          const day = parseInt(parts[2], 10);
          const month = parseInt(parts[1], 10);
          return `${day}/${month}`;
        };

        const italDate = formatItalianDate(data.metadata.date);
        const assistantMsgId = `assistant_${Date.now()}`;
        const responseText = `Ho importato con successo il foglio presenze della pedana ${data.metadata.platform.toUpperCase()} del ${italDate}:
• Presenze totali rilevate e sincronizzate: ${data.dailyPresencesImported} presenze.
• Righe ambigue da rivedere nella sezione abbonati: ${data.ambiguousCount} righe.

Puoi ora interrogarmi direttamente su questi dati!`;
        
        await setDoc(doc(db, `assistantSessions/${sessionId}/messages/${assistantMsgId}`), {
          role: "assistant",
          content: responseText,
          timestamp: new Date().toISOString()
        });
      } else {
        alert(data.error || "Errore nel caricamento del file.");
      }
    } catch (err: any) {
      console.error("Error uploading file in chat:", err);
      alert(err.message || "Errore di rete durante il caricamento.");
    } finally {
      setIsUploading(false);
      setIsTyping(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const currentText = input;
    setInput("");
    setIsTyping(true);

    try {
      // First ensure session document has a title if it's the first message
      const isNewSession = messages.length === 0;
      if (isNewSession) {
        await setDoc(doc(db, "assistantSessions", sessionId), {
          id: sessionId,
          title: currentText.substring(0, 40) + (currentText.length > 40 ? "..." : ""),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        // Just update updatedAt
        await setDoc(doc(db, "assistantSessions", sessionId), {
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

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

  const handleNewChat = () => {
    const newId = `session_${Math.random().toString(36).substring(2, 11)}`;
    setSessionId(newId);
    localStorage.setItem("samarinda_ai_session_id", newId);
    setInput("");
  };

  const handleDeleteSession = async (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Sei sicuro di voler eliminare questa sessione di chat e tutta la sua cronologia?")) return;

    try {
      // 1. Delete all messages first
      const msgsRef = collection(db, `assistantSessions/${idToDelete}/messages`);
      const snapshot = (await getDocs(msgsRef)) as any;
      const deletePromises: Promise<void>[] = [];
      snapshot.forEach((docSnap: any) => {
        deletePromises.push(deleteDoc(doc(db, `assistantSessions/${idToDelete}/messages/${docSnap.id}`)));
      });
      await Promise.all(deletePromises);

      // 2. Delete session document
      await deleteDoc(doc(db, "assistantSessions", idToDelete));

      // 3. Switch active session if we deleted the current one
      if (sessionId === idToDelete) {
        const remaining = sessions.filter(s => s.id !== idToDelete);
        if (remaining.length > 0) {
          setSessionId(remaining[0].id);
          localStorage.setItem("samarinda_ai_session_id", remaining[0].id);
        } else {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  };

  const handleClearCurrentChat = async () => {
    if (!window.confirm("Sei sicuro di voler svuotare i messaggi di questa conversazione?")) return;
    
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
    <div id="ai-assistant-module-container" className="h-[calc(100vh-13rem)] min-h-[500px] grid grid-cols-1 lg:grid-cols-4 bg-white border border-slate-200 rounded-3xl shadow-xl overflow-hidden font-sans">
      
      {/* 1. SIDEBAR: CHAT SESSIONS */}
      <div className="lg:col-span-1 bg-slate-900 border-r border-slate-800 flex flex-col h-full text-slate-200">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-black tracking-wider uppercase text-slate-100">Sessioni Chat</span>
          </div>
          <button
            id="btn-new-chat-sidebar"
            onClick={handleNewChat}
            title="Inizia nuova conversazione"
            className="p-1.5 bg-[#025A70] hover:bg-[#014152] active:bg-[#01313d] text-white rounded-lg transition-all flex items-center gap-1 text-[11px] font-black tracking-wide cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuova</span>
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingSessions ? (
            <div className="flex flex-col items-center justify-center py-8 text-xs text-slate-500 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#025A70]" />
              <span>Caricamento sessioni...</span>
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-6 italic px-3">
              Nessuna conversazione registrata. Clicca su "Nuova" per iniziare.
            </p>
          ) : (
            sessions.map((sess) => {
              const isActive = sess.id === sessionId;
              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    setSessionId(sess.id);
                    localStorage.setItem("samarinda_ai_session_id", sess.id);
                  }}
                  className={`group p-3 rounded-xl flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                    isActive
                      ? "bg-slate-800/80 text-white font-semibold border-l-4 border-[#025A70]"
                      : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-amber-400" : "text-slate-500"}`} />
                    <span className="text-xs truncate max-w-[150px]">{sess.title}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(sess.id, e)}
                    className="p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity rounded-md hover:bg-slate-700/50"
                    title="Elimina sessione"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Info Box */}
        <div className="p-3.5 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-400 space-y-1.5">
          <p className="font-bold text-[11px] text-slate-300">💡 Memoria Completa</p>
          <p className="leading-relaxed">
            Ogni discussione ha memoria persistente. L'assistente ricorda i turni precedenti per darti supporto e rispondere a follow-up accurati.
          </p>
        </div>
      </div>

      {/* 2. MAIN COLUMN: CHAT WINDOW */}
      <div className="lg:col-span-3 flex flex-col h-full bg-slate-50">
        
        {/* Workspace Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-[#EAF4F6] p-2 rounded-xl text-[#025A70]">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-xs font-black tracking-wider text-slate-800 uppercase">Assistente AI • Lido Samarinda</h2>
              <span className="text-[10px] text-slate-400 font-mono block">Session ID: {sessionId || "Seleziona sessione"}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearCurrentChat}
              disabled={messages.length === 0}
              className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold disabled:opacity-50 cursor-pointer border border-slate-200/50 hover:border-rose-100"
              title="Svuota conversazione"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Svuota Chat</span>
            </button>
          </div>
        </div>

        {/* Messages Stream with Drag & Drop */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`flex-1 overflow-y-auto p-6 space-y-4 relative transition-colors duration-200 ${
            dragActive ? "bg-emerald-50/95 border-4 border-dashed border-[#025A70] scale-98 m-3 rounded-2xl" : "bg-slate-50/50"
          }`}
        >
          {dragActive && (
            <div className="absolute inset-0 bg-emerald-50/90 backdrop-blur-xs flex flex-col items-center justify-center text-center pointer-events-none z-10 p-6 space-y-2.5">
              <div className="w-20 h-20 bg-emerald-100 text-[#025A70] rounded-full flex items-center justify-center shadow-lg animate-bounce">
                <FileText className="w-10 h-10" />
              </div>
              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">Rilascia il file per importare nel lido</h4>
              <p className="text-xs text-slate-500 max-w-sm">Rilascia il file .docx o .xlsx per caricare e analizzare le presenze. L'importazione avverrà immediatamente.</p>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
              <div className="w-16 h-16 bg-[#EAF4F6] text-[#025A70] rounded-3xl flex items-center justify-center shadow-inner">
                <Sparkles className="w-7 h-7 text-amber-500 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">Come posso esserti utile oggi?</h4>
                <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                  Conversa liberamente con me! Posso consultare lo storico dei lettini, analizzare l'anagrafica clienti, abbonamenti e proporti inserimenti rapidi sulla mappa giornaliera.
                </p>
              </div>

              {/* Suggestions Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl pt-4">
                {[
                  { title: "Verifica Presenze", desc: "Chi c'era al lettino 15 il 04 luglio 2026?", query: "Chi c'era al lettino 15 il 04 luglio 2026?" },
                  { title: "Cerca Abbonamento", desc: "Cerca tutti gli abbonati a nome 'Bianchi'", query: "Cerca tutti gli abbonati a nome Bianchi" },
                  { title: "Disponibilità Lettini", desc: "Verifica disponibilità per pedana destra domani", query: "Controlla lo stato della disponibilità per la pedana destra domani" },
                  { title: "Pianifica Tariffe", desc: "Secondo te conviene alzare i prezzi dei lettini di 2€?", query: "Secondo te conviene alzare i prezzi dei lettini di 2€ per la prossima stagione? Discutiamo i pro e i contro." }
                ].map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(sug.query)}
                    className="p-3 bg-white hover:bg-[#EAF4F6]/40 border border-slate-200/60 rounded-2xl text-left transition-all hover:border-[#025A70] hover:shadow-md cursor-pointer group"
                  >
                    <span className="text-xs font-black text-[#025A70] block group-hover:text-[#014152]">{sug.title}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5 block line-clamp-1">{sug.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="space-y-3.5">
                {/* Chat Bubble */}
                <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "bg-[#025A70] text-white rounded-br-none"
                        : "bg-white border border-slate-200 text-slate-800 rounded-bl-none whitespace-pre-wrap"
                    }`}
                  >
                    {m.attachment ? (
                      <a
                        href={m.attachment.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 cursor-pointer group hover:opacity-90"
                      >
                        <div className="p-2 bg-white/20 rounded-xl text-white shrink-0 group-hover:bg-white/30 transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="text-left min-w-0">
                          <p className="font-bold text-[11px] truncate max-w-[200px] group-hover:underline">{m.attachment.name}</p>
                          <p className="text-[9px] opacity-80">{formatSize(m.attachment.size)}</p>
                        </div>
                      </a>
                    ) : (
                      m.content
                    )}
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
            <div className="flex justify-start items-center gap-2 bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-md text-xs font-bold text-[#025A70] w-max animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{isUploading ? "Caricamento e analisi del foglio..." : "L'Assistente sta elaborando..."}</span>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>

        {/* Input and Attachment Bar */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <form onSubmit={handleSendMessage} className="flex gap-2.5 items-end max-w-5xl mx-auto">
            {/* Attach File Button */}
            <button
              id="btn-ai-attach-file-chat"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-xl transition-all flex items-center justify-center shrink-0 cursor-pointer border border-slate-200/30"
              title="Carica foglio presenze (.docx, .xlsx)"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleUploadFile(e.target.files[0]);
                }
              }}
              className="hidden"
              accept=".docx,.xlsx"
            />

            {/* Input field */}
            <div className="flex-1 relative">
              <textarea
                id="input-ai-text-fullpage"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                placeholder="Chiedi all'AI o trascina/carica un file .docx o .xlsx per caricarlo..."
                className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#025A70] transition-all resize-none min-h-[44px] max-h-[120px]"
              />
              <button
                id="btn-ai-send-message-chat"
                type="submit"
                disabled={!input.trim()}
                className="absolute right-2.5 bottom-2 p-2 bg-[#025A70] hover:bg-[#014152] disabled:opacity-40 text-white rounded-lg shadow-md transition-all flex items-center justify-center shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
          <div className="text-center text-[9px] text-slate-400 mt-2 font-medium">
            Lido Samarinda AI Assistant • Carica un file per analizzarlo o fai domande liberamente. Invio per trasmettere, Shift+Invio per nuova riga.
          </div>
        </div>

      </div>
    </div>
  );
}

const slugify = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

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
    if (!formData.periods || formData.periods.length === 0) {
      setStatusText("Periodo mancante — impossibile salvare, richiedi una nuova proposta o inserisci il periodo manualmente");
      return;
    }
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
        const firstPeriod = formData.periods[0];
        const sortedBeds = formData.bedNumbers ? [...formData.bedNumbers].sort((a: any, b: any) => Number(a) - Number(b)).join("-") : "";
        const subId = `sub_${slugify(formData.customerName)}_${sortedBeds}_${firstPeriod.startDate}`;
        const subDocRef = doc(db, "subscriptions", subId);
        
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

        // Step C: Generate Bookings inside transaction
        for (const period of formData.periods) {
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
        <div className="flex items-center gap-1.5 text-amber-700 font-extrabold text-xs uppercase tracking-wide">
          <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{proposal.type === "subscription" ? "Proposta d'Abbonamento" : "Proposta Prenotazione"}</span>
        </div>
        {!isConfirmed && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-amber-100 text-[10px] font-bold text-amber-700 rounded-lg transition-colors cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
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
                  <span key={i} className="block pl-2 text-slate-500 font-medium">
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
            {formData.notes && <p><strong>Note:</strong> <span className="text-slate-500 italic font-medium">{formData.notes}</span></p>}
          </div>
        )}
      </div>

      {/* ACTION BUTTONS */}
      {!isConfirmed ? (
        <button
          onClick={proposal.type === "subscription" ? confirmSubscription : confirmDailyMap}
          disabled={submitting || (proposal.type === "subscription" && (!formData.periods || formData.periods.length === 0))}
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

      {proposal.type === "subscription" && (!formData.periods || formData.periods.length === 0) && (
        <p className="text-[10px] text-center font-semibold text-rose-700">
          Periodo mancante — impossibile salvare, richiedi una nuova proposta o inserisci il periodo manualmente
        </p>
      )}

      {statusText && (
        <p className={`text-[10px] text-center font-semibold ${isConfirmed ? "text-emerald-700" : "text-rose-700"}`}>
          {statusText}
        </p>
      )}

    </div>
  );
}
