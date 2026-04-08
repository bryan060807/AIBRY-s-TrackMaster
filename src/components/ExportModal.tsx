import React, { useState } from 'react';
import { X, Download, Music, FileAudio } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: 'wav' | 'mp3', bitrate: number) => void;
  accentBg: string;
  accentClass: string;
  isExporting: boolean;
  canExport: boolean;
}

export function ExportModal({ isOpen, onClose, onExport, accentBg, accentClass, isExporting, canExport }: ExportModalProps) {
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [bitrate, setBitrate] = useState<number>(320);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border-2 border-zinc-800 rounded-sm w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b-2 border-zinc-900 bg-[#111]">
          <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-100">Export Track</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Format Selection */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Format</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('wav')}
                className={`flex flex-col items-center justify-center p-4 rounded-sm border-2 transition-all ${format === 'wav' ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-600'}`}
              >
                <FileAudio size={24} className="mb-2" />
                <span className="font-mono font-bold uppercase tracking-wider text-zinc-300">WAV</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">Lossless</span>
              </button>
              <button
                onClick={() => setFormat('mp3')}
                className={`flex flex-col items-center justify-center p-4 rounded-sm border-2 transition-all ${format === 'mp3' ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-600'}`}
              >
                <Music size={24} className="mb-2" />
                <span className="font-mono font-bold uppercase tracking-wider text-zinc-300">MP3</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">Compressed</span>
              </button>
            </div>
          </div>

          {/* Bitrate Selection (Only for MP3) */}
          {format === 'mp3' && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Bitrate</label>
              <div className="grid grid-cols-3 gap-2">
                {[128, 192, 320].map(br => (
                  <button
                    key={br}
                    onClick={() => setBitrate(br)}
                    className={`py-2 rounded-sm border-2 transition-all text-xs font-mono font-bold uppercase tracking-wider ${bitrate === br ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black text-zinc-600 hover:bg-zinc-900'}`}
                  >
                    {br}k
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t-2 border-zinc-900 bg-[#111] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-sm font-mono font-bold text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => canExport && onExport(format, bitrate)}
            disabled={isExporting || !canExport}
            title={canExport ? 'Render the loaded track' : 'Load a track before exporting'}
            className={`flex items-center gap-2 px-6 py-2 rounded-sm font-mono font-bold text-xs uppercase tracking-widest transition-all ${accentBg} text-black hover:opacity-90 disabled:opacity-50 shadow-[0_2px_5px_rgba(0,0,0,0.5)] active:shadow-none active:translate-y-[1px]`}
          >
            {isExporting ? 'Rendering...' : 'Render'}
            {!isExporting && <Download size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
