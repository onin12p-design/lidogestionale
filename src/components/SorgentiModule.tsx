import React, { useState, useEffect, useRef } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, Search, Download, Trash2, Folder, Loader2 } from "lucide-react";

interface SourceFile {
  id: string;
  path: string;
  name: string;
  size: number;
  downloadUrl: string;
  uploadedAt: string;
  dailyPresencesImported?: number;
}

export default function SorgentiModule() {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  
  // Selection states
  const [platform, setPlatform] = useState<"sx" | "dx">("dx");
  const [month, setMonth] = useState<"giugno" | "luglio" | "agosto" | "settembre">("luglio");
  
  // UI States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sorgenti/list");
      const data = await res.json();
      if (data.success) {
        setFiles(data.files || []);
      }
    } catch (err) {
      console.error("Error fetching source files:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

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
      await uploadFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await uploadFiles(e.target.files);
    }
  };

  const uploadFiles = async (fileList: FileList) => {
    setUploading(true);
    setStatusMessage(null);
    
    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append("files", fileList[i]);
    }
    
    // Construct target folder
    const targetFolder = `${platform}/${month}`;
    formData.append("folder", targetFolder);

    try {
      const res = await fetch("/api/sorgenti/upload", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        let msg = `Caricamento completato con successo! Importati ${data.dailyPresencesImported || 0} record storici.`;
        if (data.errors && data.errors.length > 0) {
          msg += ` Alcuni errori si sono verificati: ${data.errors.join(", ")}`;
        }
        setStatusMessage({
          type: data.errors && data.errors.length > 0 ? "error" : "success",
          text: msg
        });
        await fetchFiles();
      } else {
        setStatusMessage({
          type: "error",
          text: data.error || "Errore durante il caricamento."
        });
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Errore di connessione."
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const filteredFiles = files.filter(f => {
    const query = searchQuery.toLowerCase();
    return (
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query)
    );
  });

  return (
    <div id="sorgenti-module" className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
      
      {/* 1. SELECTION & UPLOAD SECTION */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Folder className="w-5 h-5 text-[#025A70]" />
            <h2 className="text-base font-bold text-slate-800">Parametri di Destinazione</h2>
          </div>
          
          <p className="text-xs text-slate-400 leading-relaxed">
            Seleziona la pedana e il mese in cui archiviare i fogli delle presenze. L'assistente leggerà i file archiviati in questa struttura.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Pedana</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPlatform("sx")}
                  className={`py-2 px-3 text-xs font-bold rounded-xl transition-all border ${
                    platform === "sx"
                      ? "bg-[#025A70] text-white border-[#025A70] shadow-sm"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  Sinistra (SX)
                </button>
                <button
                  onClick={() => setPlatform("dx")}
                  className={`py-2 px-3 text-xs font-bold rounded-xl transition-all border ${
                    platform === "dx"
                      ? "bg-[#025A70] text-white border-[#025A70] shadow-sm"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  Destra (DX)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Mese di Riferimento</label>
              <select
                value={month}
                onChange={(e: any) => setMonth(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#025A70]"
              >
                <option value="giugno">Giugno</option>
                <option value="luglio">Luglio</option>
                <option value="agosto">Agosto</option>
                <option value="settembre">Settembre</option>
              </select>
            </div>
          </div>
        </div>

        {/* DRAG & DROP BOX */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
          className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[220px] ${
            dragActive
              ? "border-[#025A70] bg-[#EAF4F6]/40"
              : "border-slate-200 bg-white hover:border-[#025A70] hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            accept=".docx,.xlsx"
          />
          
          {uploading ? (
            <div className="space-y-3">
              <Loader2 className="w-10 h-10 text-[#025A70] animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-700">Elaborazione e importazione in corso...</p>
              <p className="text-[10px] text-slate-400">Analisi deterministica delle tabelle Word e Storage</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#EAF4F6] text-[#025A70] flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700">Trascina qui i fogli presenze (.docx, .xlsx)</p>
                <p className="text-[10px] text-slate-400 mt-1">oppure clicca per sfogliare i file locali</p>
              </div>
              <div className="inline-block px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 font-mono text-[9px]">
                Max 10MB per file
              </div>
            </div>
          )}
        </div>

        {statusMessage && (
          <div
            className={`p-4 rounded-2xl border text-xs flex gap-2 items-start shadow-sm leading-relaxed ${
              statusMessage.type === "success"
                ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                : "bg-rose-50 border-rose-100 text-rose-800"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {/* 2. ARCHIVE LIST SECTION */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-800">Documenti Sorgenti Archiviati</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">Elenco completo dei file importati per l'analisi</p>
            </div>
            
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Cerca file o percorso..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-[#025A70]"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-[#025A70]" />
              <p className="text-xs">Caricamento archivio in corso...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="py-12 text-center text-slate-400 border border-dashed border-slate-100 rounded-2xl">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-semibold">Nessun file trovato</p>
              <p className="text-[10px] mt-0.5">I file caricati appariranno qui organizzati in tempo reale.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <th className="py-2 pb-3">Nome File</th>
                    <th className="py-2 pb-3">Percorso Storage</th>
                    <th className="py-2 pb-3">Dimensione</th>
                    <th className="py-2 pb-3">Data Caricamento</th>
                    <th className="py-2 pb-3 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-xs">
                  {filteredFiles.map((file) => {
                    const isDocx = file.name.toLowerCase().endsWith(".docx");
                    return (
                      <tr key={file.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 font-semibold text-slate-800">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${isDocx ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"}`}>
                              <FileText className="w-4 h-4" />
                            </div>
                            <span className="truncate max-w-[160px]" title={file.name}>
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 font-mono text-[10px] text-slate-400">
                          {file.path}
                        </td>
                        <td className="py-3 text-slate-500 font-medium">
                          {formatSize(file.size)}
                        </td>
                        <td className="py-3 text-slate-500">
                          {new Date(file.uploadedAt).toLocaleString("it-IT", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </td>
                        <td className="py-3 text-right">
                          <a
                            href={`/api/sorgenti/download?path=${encodeURIComponent(file.path)}`}
                            download={file.name}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-[#025A70] hover:text-white text-slate-600 font-bold rounded-lg transition-all text-[10px] cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            Scarica
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
    </div>
  );
}
