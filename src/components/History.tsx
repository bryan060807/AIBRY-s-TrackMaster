import React, { useEffect, useState } from 'react';
import { Download, Clock, Music, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { deleteTrack, downloadTrack, listTracks, TrackRecord } from '../lib/dataService';

export function History({ accentClass }: { accentClass: string }) {
  const [history, setHistory] = useState<TrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
    const refresh = () => fetchHistory();
    window.addEventListener('trackmaster:tracks-changed', refresh);
    return () => window.removeEventListener('trackmaster:tracks-changed', refresh);
  }, []);

  const fetchHistory = async () => {
    try {
      const { tracks } = await listTracks();
      setHistory(tracks);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch local mastering logs", err);
      setError('Local logs are unavailable until the garage API is running.');
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (track: TrackRecord) => {
    setProcessingId(track.id);
    void (async () => {
      try {
        const blob = await downloadTrack(track.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Mastered_${track.fileName}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Download failed", err);
        setError('Download is unavailable for this local track.');
      } finally {
        setProcessingId(null);
      }
    })();
  };

  const handleDeleteTrack = async (track: TrackRecord) => {
    if (!confirm(`Permanently delete "${track.fileName}" from local storage?`)) return;
    
    setProcessingId(track.id);
    try {
      await deleteTrack(track.id);
      setHistory(prev => prev.filter(t => t.id !== track.id));
    } catch (err) {
      console.error("Deletion failed", err);
      alert("Failed to delete track");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-zinc-600 font-mono text-[10px] uppercase tracking-widest">
        <Loader2 size={12} className="animate-spin" />
        Syncing_Logs...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-sm border border-amber-500/20 bg-amber-500/10 p-3 text-[9px] font-mono uppercase tracking-wider text-amber-100/80">
          {error}
        </div>
      )}

      <AnimatePresence initial={false}>
        {history.map((track) => (
          <motion.div 
            key={track.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-black/40 border border-zinc-800/50 p-3 rounded-sm flex items-center justify-between group hover:border-zinc-700/50 transition-colors"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <Music size={14} className={`${accentClass} opacity-50 group-hover:opacity-100 transition-opacity`} />
              <div className="overflow-hidden">
                <p className="text-[10px] font-mono font-bold text-zinc-300 truncate max-w-[120px] uppercase tracking-wider">
                  {track.fileName}
                </p>
                <div className="flex items-center gap-2 opacity-40">
                  <Clock size={10} />
                  <span className="text-[8px] font-mono">
                    {new Date(track.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              <button 
                onClick={() => downloadFile(track)}
                disabled={!!processingId}
                className="p-2 hover:bg-zinc-800 rounded-sm transition-all group/btn"
                title="Download"
              >
                {processingId === track.id ? (
                  <Loader2 size={14} className={`animate-spin ${accentClass}`} />
                ) : (
                  <Download size={14} className="text-zinc-500 group-hover/btn:text-zinc-200" />
                )}
              </button>

              <button 
                onClick={() => handleDeleteTrack(track)}
                disabled={!!processingId}
                className="p-2 hover:bg-red-500/10 rounded-sm transition-all group/trash"
                title="Delete from local storage"
              >
                <Trash2 size={14} className="text-zinc-600 group-hover/trash:text-red-500" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      
      {history.length === 0 && (
        <div className="text-center py-10 space-y-2 opacity-40">
          <Music size={24} className="mx-auto" />
          <p className="text-[9px] font-mono uppercase tracking-[0.2em]">No Logs Detected</p>
          <p className="mx-auto max-w-[180px] text-[8px] font-mono uppercase tracking-wider text-zinc-500">
            Export a track to create a local mastering log.
          </p>
        </div>
      )}
    </div>
  );
}
