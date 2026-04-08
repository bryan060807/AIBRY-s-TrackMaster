import React from 'react';
import { ShieldCheck, Activity, ArrowLeft, Download } from 'lucide-react';

export const PrivacyPolicy = () => {
  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-400 font-mono p-4 md:p-10 print:bg-white print:text-black">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-12 border-b border-zinc-800 pb-6 print:border-black">
          <div className="flex items-center gap-4">
            <ShieldCheck className="text-amber-400 print:text-black" size={32} />
            <div>
              <h1 className="text-xl font-bold text-white uppercase tracking-[0.3em] print:text-black">Privacy_Protocol</h1>
              <p className="text-[10px] uppercase text-zinc-500">Document_ID: AIB-PRV-2026</p>
            </div>
          </div>
          <div className="flex gap-4 print:hidden">
            <button onClick={handlePrint} className="flex items-center gap-2 text-[10px] uppercase hover:text-white transition-colors border border-zinc-800 px-3 py-1.5 rounded-sm">
              <Download size={14} /> [ Print_Manual ]
            </button>
            <button onClick={() => window.location.href = '/'} className="flex items-center gap-2 text-[10px] uppercase hover:text-white transition-colors border border-zinc-800 px-3 py-1.5 rounded-sm">
              <ArrowLeft size={14} /> [ Back_to_Rack ]
            </button>
          </div>
        </header>

        <section className="space-y-10 print:space-y-6">
          <div className="rack-panel p-8 relative border border-zinc-800 bg-[#111] print:bg-transparent print:border-black print:p-4">
            <h2 className="text-white text-xs font-bold uppercase mb-4 tracking-widest print:text-black">// 01_DATA_ENCRYPTION</h2>
            <p className="text-[12px] leading-relaxed">
              AIBRY TrackMaster uses local account authentication for access control. Account credentials are stored on the garage server and audio processing occurs in the browser.
            </p>
          </div>

          <div className="rack-panel p-8 relative border border-zinc-800 bg-[#111] print:bg-transparent print:border-black print:p-4">
            <h2 className="text-white text-xs font-bold uppercase mb-4 tracking-widest print:text-black">// 02_AUDIO_PROCESSING</h2>
            <p className="text-[12px] leading-relaxed">
              Digital Signal Processing occurs in the browser via the Web Audio API. Mastered exports are stored on the local garage server filesystem and indexed in a local SQLite database.
            </p>
          </div>
        </section>

        <footer className="mt-20 pt-10 border-t border-zinc-900 text-center print:border-black">
          <p className="text-[9px] uppercase tracking-[0.4em] opacity-30 print:opacity-100">AIBRY Hardware Security Module // v2.0.26</p>
        </footer>
      </div>
    </div>
  );
};
