import React, { useState } from "react";
import { Booking, Customer, BookingSlot, CustomerType } from "../types";
import { getFirestore, setDoc, doc, collection, writeBatch, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType, createBookingTransactional } from "../lib/firebase";
import { isValidBedNumber, sanitizeForFirestore } from "../utils";
import { Upload, AlertTriangle, Check, Trash2, Plus, Sparkles, Loader2 } from "lucide-react";

interface ScannerModuleProps {
  currentDate: string;
  existingBookings: Booking[];
  onImportComplete: () => void;
}

interface ExtractedItem {
  id: string; // temporary key
  bedNumber: number;
  customerName: string;
  customerType: CustomerType;
  slot: BookingSlot;
  notes?: string;
  isValidBed: boolean;
  fileName?: string;
  importAction: "overwrite" | "skip" | "create";
}

export default function ScannerModule({ currentDate, existingBookings, onImportComplete }: ScannerModuleProps) {
  const [uploading, setUploading] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ successCount: number; failedCount: number; failures: Array<{ bed: number; slot: string; reason: string }> } | null>(null);

  // File selection change
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const response = await fetch("/api/parse-scanner", {
        method: "POST",
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Errore durante il parsing dei file.");
      }

      if (data.items && Array.isArray(data.items)) {
        const mapped: ExtractedItem[] = data.items.map((item: any, index: number) => {
          const bedNum = Number(item.bedNumber);
          const isValid = isValidBedNumber(bedNum);
          
          // Determine if there is a conflict
          const conflict = checkSingleBookingConflict(bedNum, item.slot);

          return {
            id: `extracted-${Date.now()}-${index}`,
            bedNumber: bedNum,
            customerName: item.customerName || "Cliente",
            customerType: item.customerType || "daily",
            slot: item.slot || "full_day",
            notes: item.notes || "",
            isValidBed: isValid,
            fileName: item.fileName,
            importAction: conflict ? "skip" : "create"
          };
        });

        setExtractedItems(mapped);
        if (mapped.length === 0) {
          setErrorMessage("Nessuna prenotazione estratta. Verifica che il documento sia leggibile.");
        }
      }

      if (data.errors && Array.isArray(data.errors)) {
        setErrorMessage(`Alcuni file hanno generato errori: ${data.errors.join("; ")}`);
      }

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Impossibile elaborare i file caricati.");
    } finally {
      setUploading(false);
    }
  };

  // Check if a bed booking has conflict with existing ones
  const checkSingleBookingConflict = (bedNum: number, slot: BookingSlot): boolean => {
    return existingBookings.some((b) => {
      if (b.bedNumber !== bedNum) return false;
      // Conflict conditions:
      // - exact slot matches
      // - either one is full_day
      return b.slot === slot || b.slot === "full_day" || slot === "full_day";
    });
  };

  // Modify field of an item
  const updateItemField = (id: string, field: keyof ExtractedItem, value: any) => {
    setExtractedItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };
        
        // Re-validate bed number if modified
        if (field === "bedNumber") {
          const num = Number(value);
          updated.bedNumber = num;
          updated.isValidBed = isValidBedNumber(num);
        }

        // Re-evaluate conflict if bed number or slot changed
        if (field === "bedNumber" || field === "slot") {
          const conflict = checkSingleBookingConflict(updated.bedNumber, updated.slot);
          updated.importAction = conflict ? "skip" : "create";
        }

        return updated;
      })
    );
  };

  // Delete item from list
  const deleteItem = (id: string) => {
    setExtractedItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Add blank row
  const addBlankRow = () => {
    const newItem: ExtractedItem = {
      id: `manual-add-${Date.now()}`,
      bedNumber: 1,
      customerName: "",
      customerType: "daily",
      slot: "full_day",
      notes: "",
      isValidBed: true,
      importAction: "create"
    };
    setExtractedItems((prev) => [...prev, newItem]);
  };

  // Final transactional import to Firestore
  const handleImportAll = async () => {
    setUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setImportResult(null);

    let successCount = 0;
    let failedCount = 0;
    const failures: Array<{ bed: number; slot: string; reason: string }> = [];

    try {
      const itemsToImport = extractedItems.filter(item => item.isValidBed && item.importAction !== "skip");

      if (itemsToImport.length === 0) {
        throw new Error("Nessun lettino valido selezionato per l'importazione.");
      }

      for (const item of itemsToImport) {
        try {
          // If the action is overwrite, we delete existing conflicting bookings first
          if (item.importAction === "overwrite") {
            const conflicts = existingBookings.filter((b) => {
              if (b.bedNumber !== item.bedNumber) return false;
              return b.slot === item.slot || b.slot === "full_day" || item.slot === "full_day";
            });

            for (const b of conflicts) {
              await deleteDoc(doc(db, "bookings", b.id));
            }
          }

          // 1. Create customer document
          const custId = `cust_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const customerRef = doc(collection(db, "customers"), custId);
          
          await setDoc(customerRef, sanitizeForFirestore({
            name: item.customerName,
            type: item.customerType,
            notes: item.notes || ""
          }));

          // 2. Create the booking document via transaction
          const bookingData = sanitizeForFirestore({
            bedNumber: item.bedNumber,
            date: currentDate,
            slot: item.slot,
            customerId: custId,
            customerName: item.customerName,
            customerType: item.customerType,
            source: "scanner" as const,
            notes: item.notes || ""
          });

          const txResult = await createBookingTransactional(bookingData);

          if (txResult.success) {
            successCount++;
          } else {
            failedCount++;
            failures.push({
              bed: item.bedNumber,
              slot: item.slot,
              reason: txResult.error || "Doppia prenotazione rilevata tramite transazione."
            });
          }
        } catch (err: any) {
          failedCount++;
          failures.push({
            bed: item.bedNumber,
            slot: item.slot,
            reason: err.message || "Errore sconosciuto di scrittura"
          });
        }
      }

      setImportResult({
        successCount,
        failedCount,
        failures
      });

      if (failedCount === 0) {
        setSuccessMessage(`Importazione completata con successo! Inserite ${successCount} prenotazioni.`);
        setExtractedItems([]);
      } else if (successCount > 0) {
        setSuccessMessage(`Importazione parziale completata. Inserite ${successCount} prenotazioni.`);
      } else {
        setErrorMessage("Nessuna prenotazione importata a causa di conflitti o errori.");
      }

      onImportComplete();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Errore durante il salvataggio delle prenotazioni.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div id="scanner-module-root" className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Scanner Documenti & Fogli di Lavoro</h2>
          <p className="text-xs text-slate-500">
            Trascina o seleziona fogli, foto o elenchi .docx. L'AI estrarrà i dati dei lettini per la data odierna ({currentDate}).
          </p>
        </div>

        {/* Upload area */}
        <label id="upload-label" className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl cursor-pointer shadow-sm transition-colors self-start md:self-auto">
          <Upload className="w-4 h-4" />
          <span>Carica File (Immagini / .docx)</span>
          <input
            id="scanner-file-input"
            type="file"
            multiple
            accept="image/*,.docx,.pdf"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {uploading && (
        <div id="scanner-loader" className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-700">Analisi in corso con Gemini AI...</p>
          <p className="text-xs text-slate-400 mt-1">Stiamo leggendo e strutturando i dati dei lettini.</p>
        </div>
      )}

      {/* Error and Success displays */}
      {errorMessage && (
        <div id="scanner-error" className="flex items-start gap-2 p-4 bg-rose-50 border border-rose-100 rounded-xl mb-4 text-sm text-rose-700">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>{errorMessage}</div>
        </div>
      )}

      {successMessage && (
        <div id="scanner-success" className="flex items-center gap-2 p-4 bg-emerald-50 border border-emerald-100 rounded-xl mb-4 text-sm text-emerald-700">
          <Check className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>{successMessage}</div>
        </div>
      )}

      {importResult && (
        <div id="scanner-summary" className="p-4 bg-slate-50 border border-slate-100 rounded-xl mb-4 text-xs space-y-2">
          <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Esito Importazione:</div>
          <div className="flex gap-4">
            <span className="text-emerald-700 font-semibold">Importate con successo: {importResult.successCount}</span>
            <span className="text-rose-700 font-semibold">Fallite: {importResult.failedCount}</span>
          </div>
          {importResult.failures.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="font-semibold text-rose-600">Dettaglio fallimenti:</div>
              <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                {importResult.failures.map((f, idx) => (
                  <li key={idx}>
                    Lettino {f.bed} ({f.slot === "full_day" ? "Giornata Intera" : f.slot === "morning" ? "Mattina" : "Pomeriggio"}): <span className="font-medium text-rose-600">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Editable review table */}
      {!uploading && extractedItems.length > 0 && (
        <div id="scanner-review-section" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-blue-500" />
              Verifica e Correggi Dati Estratti
            </h3>
            <button
              id="btn-add-scan-row"
              onClick={addBlankRow}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Aggiungi Riga
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table id="scanner-review-table" className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="p-3">File di origine</th>
                  <th className="p-3 w-20">Lettino</th>
                  <th className="p-3">Nome Cliente</th>
                  <th className="p-3 w-28">Tipo Cliente</th>
                  <th className="p-3 w-32">Fascia Oraria</th>
                  <th className="p-3">Note</th>
                  <th className="p-3 w-40">Stato Import</th>
                  <th className="p-3 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {extractedItems.map((item) => {
                  const hasConflict = checkSingleBookingConflict(item.bedNumber, item.slot);
                  const isConflictWarning = hasConflict && item.importAction !== "overwrite";

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        !item.isValidBed
                          ? "bg-rose-50/50"
                          : isConflictWarning
                          ? "bg-amber-50/70"
                          : "hover:bg-slate-50/50"
                      }`}
                    >
                      {/* Original File */}
                      <td className="p-3 text-slate-400 max-w-[120px] truncate" title={item.fileName}>
                        {item.fileName || "Manuale"}
                      </td>

                      {/* Bed Number */}
                      <td className="p-3">
                        <input
                          id={`scan-bed-${item.id}`}
                          type="number"
                          value={item.bedNumber || ""}
                          onChange={(e) => updateItemField(item.id, "bedNumber", Number(e.target.value))}
                          className={`w-full px-2 py-1 bg-white border rounded text-center font-bold ${
                            !item.isValidBed ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"
                          }`}
                        />
                        {!item.isValidBed && (
                          <div className="text-[10px] text-rose-600 mt-1 font-semibold">Inesistente!</div>
                        )}
                      </td>

                      {/* Customer Name */}
                      <td className="p-3">
                        <input
                          id={`scan-name-${item.id}`}
                          type="text"
                          value={item.customerName}
                          onChange={(e) => updateItemField(item.id, "customerName", e.target.value)}
                          placeholder="Nome Cliente"
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-medium"
                        />
                      </td>

                      {/* Customer Type */}
                      <td className="p-3">
                        <select
                          id={`scan-type-${item.id}`}
                          value={item.customerType}
                          onChange={(e) => updateItemField(item.id, "customerType", e.target.value as CustomerType)}
                          className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded"
                        >
                          <option value="daily">Giornaliero</option>
                          <option value="subscriber">Abbonato</option>
                        </select>
                      </td>

                      {/* Booking Slot */}
                      <td className="p-3">
                        <select
                          id={`scan-slot-${item.id}`}
                          value={item.slot}
                          onChange={(e) => updateItemField(item.id, "slot", e.target.value as BookingSlot)}
                          className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded"
                        >
                          <option value="full_day">Giornata Intera</option>
                          <option value="morning">Mattina (AM)</option>
                          <option value="afternoon">Pomeriggio (PM)</option>
                        </select>
                      </td>

                      {/* Notes */}
                      <td className="p-3">
                        <input
                          id={`scan-notes-${item.id}`}
                          type="text"
                          value={item.notes || ""}
                          onChange={(e) => updateItemField(item.id, "notes", e.target.value)}
                          placeholder="Note"
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-slate-500"
                        />
                      </td>

                      {/* Import Action / Conflict resolution */}
                      <td className="p-3">
                        {hasConflict ? (
                          <div className="space-y-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 uppercase bg-amber-100 px-1.5 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              Conflitto!
                            </span>
                            <select
                              id={`scan-action-${item.id}`}
                              value={item.importAction}
                              onChange={(e) => updateItemField(item.id, "importAction", e.target.value as any)}
                              className="w-full px-1 py-0.5 text-xs bg-white border border-amber-300 rounded text-amber-800"
                            >
                              <option value="skip">Salta riga</option>
                              <option value="overwrite">Sovrascrivi esistente</option>
                            </select>
                          </div>
                        ) : item.isValidBed ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 uppercase bg-emerald-100 px-1.5 py-0.5 rounded">
                            Pronto per import
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 uppercase bg-rose-100 px-1.5 py-0.5 rounded">
                            Non Valido
                          </span>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="p-3 text-center">
                        <button
                          id={`btn-del-scan-row-${item.id}`}
                          onClick={() => deleteItem(item.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors"
                          title="Rimuovi"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <button
              id="btn-scan-cancel"
              onClick={() => setExtractedItems([])}
              className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-semibold hover:bg-slate-50 rounded-xl transition-colors"
            >
              Annulla
            </button>
            <button
              id="btn-scan-import-submit"
              onClick={handleImportAll}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Conferma e Importa ({extractedItems.filter(i => i.isValidBed && i.importAction !== "skip").length})</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
