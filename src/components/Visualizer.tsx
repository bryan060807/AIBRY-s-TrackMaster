import { useEffect, useRef, useState } from 'react';
import { Activity, BarChart2, Waves } from 'lucide-react';

export type VisualizerMode = 'spectrum' | 'waveform' | 'spectrogram';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  accentColor: string;
  hasAudio: boolean;
}

export function Visualizer({ analyser, isPlaying, accentColor, hasAudio }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [mode, setMode] = useState<VisualizerMode>('spectrum');
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fftSize = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(fftSize);
    const timeDomainData = new Uint8Array(fftSize);

    if (!spectrogramCanvasRef.current) {
      spectrogramCanvasRef.current = document.createElement('canvas');
    }
    const specCanvas = spectrogramCanvasRef.current;
    const specCtx = specCanvas.getContext('2d');

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const paddingBottom = 24;
      const drawHeight = height - paddingBottom;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      if (mode === 'spectrum') {
        if (isPlaying) {
          analyser.getByteFrequencyData(dataArray);
        } else {
          dataArray.forEach((v, i) => dataArray[i] = Math.max(0, v - 4));
        }

        // --- LOGARITHMIC SPECTRUM (Fixes the glitchy/cramped bass) ---
        const barWidth = 2; // Fixed width for a "digital" look
        const gap = 1;
        const totalBars = Math.floor(width / (barWidth + gap));
        
        for (let i = 0; i < totalBars; i++) {
          // Logarithmic mapping: spreads low frequencies across more bars
          const logIndex = Math.pow(i / totalBars, 2) * (fftSize * 0.85);
          const lowIdx = Math.floor(logIndex);
          const highIdx = Math.ceil(logIndex);
          const binValue = dataArray[lowIdx] + (dataArray[highIdx] - dataArray[lowIdx]) * (logIndex - lowIdx);

          const barHeight = (binValue / 255) * drawHeight;
          const x = i * (barWidth + gap);
          
          // Draw segmented bar
          const segH = 3;
          const segG = 1;
          const segments = Math.floor(barHeight / (segH + segG));

          for (let s = 0; s < segments; s++) {
            const y = drawHeight - (s + 1) * (segH + segG);
            ctx.globalAlpha = 0.4 + (s / (drawHeight / (segH + segG)) * 0.6);
            ctx.fillStyle = accentColor;
            ctx.fillRect(x, y, barWidth, segH);
          }
        }

        // --- CRISP GUIDES & LABELS ---
        ctx.globalAlpha = 1.0;
        const labels = [
          { hz: '20Hz', f: 20 },
          { hz: '100Hz', f: 100 },
          { hz: '500Hz', f: 500 },
          { hz: '1kHz', f: 1000 },
          { hz: '5kHz', f: 5000 },
          { hz: '15kHz', f: 15000 }
        ];

        ctx.font = '9px "JetBrains Mono", monospace';
        const sampleRate = analyser.context.sampleRate;

        labels.forEach(l => {
          // Find where this frequency sits in our log scale
          const bin = (l.f / (sampleRate / 2)) * fftSize;
          const p = Math.sqrt(bin / (fftSize * 0.85)); 
          const lx = p * width;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillRect(lx, 0, 1, drawHeight); // Vertical grid line
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillText(l.hz, lx - 10, height - 8);
        });
      } 
      
      else if (mode === 'waveform') {
        if (isPlaying) analyser.getByteTimeDomainData(timeDomainData);
        else timeDomainData.fill(128);

        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.beginPath();
        const sliceWidth = width / fftSize;
        let x = 0;
        for (let i = 0; i < fftSize; i++) {
          const v = timeDomainData[i] / 128.0;
          const y = (v * drawHeight) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
      }

      // ... Spectrogram mode (kept the fire logic but cleaned up alpha) ...
      else if (mode === 'spectrogram' && specCtx) {
        if (isPlaying) analyser.getByteFrequencyData(dataArray);
        if (specCanvas.width !== width || specCanvas.height !== height) {
          specCanvas.width = width; specCanvas.height = height;
        }
        specCtx.drawImage(specCanvas, 1, 0, width - 1, height, 0, 0, width - 1, height);
        const sliceH = height / (fftSize * 0.85);
        for (let i = 0; i < (fftSize * 0.85); i++) {
          const val = dataArray[i];
          const p = val / 255;
          specCtx.fillStyle = p > 0.8 ? '#fff' : p > 0.5 ? accentColor : `rgba(0,0,0,${p})`;
          specCtx.fillRect(width - 1, height - (i * sliceH), 1, Math.ceil(sliceH));
        }
        ctx.drawImage(specCanvas, 0, 0);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationRef.current);
  }, [analyser, isPlaying, accentColor, mode]);

  useEffect(() => {
    const resize = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        canvasRef.current.width = canvasRef.current.parentElement.clientWidth;
        canvasRef.current.height = canvasRef.current.parentElement.clientHeight;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <div className="w-full h-full relative bg-[#050505] group overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
         <img src="/logo.png" alt="" className="w-1/3 opacity-[0.03] grayscale contrast-150" />
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-10 block" />
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-20"
        style={{ backgroundImage: `linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)`, backgroundSize: '40px 40px' }}
      />
      {!hasAudio && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="rounded-sm border border-zinc-800 bg-black/70 px-4 py-3 text-center font-mono shadow-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400">Analyzer Idle</p>
            <p className="mt-2 text-[9px] uppercase tracking-wider text-zinc-600">Add audio to start metering</p>
          </div>
        </div>
      )}
      <div className="absolute top-2 right-2 flex gap-1 bg-zinc-900/90 border border-zinc-800 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
        <button onClick={() => setMode('spectrum')} className={`p-1.5 rounded ${mode === 'spectrum' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}><BarChart2 size={16} /></button>
        <button onClick={() => setMode('waveform')} className={`p-1.5 rounded ${mode === 'waveform' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}><Activity size={16} /></button>
        <button onClick={() => setMode('spectrogram')} className={`p-1.5 rounded ${mode === 'spectrogram' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}><Waves size={16} /></button>
      </div>
    </div>
  );
}
