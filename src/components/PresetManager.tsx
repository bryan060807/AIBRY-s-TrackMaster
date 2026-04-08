import React, { useState, useEffect, useRef } from 'react';
import { Save, Trash2, ChevronDown, Check, Cloud } from 'lucide-react';
import { Preset, DEFAULT_PRESETS } from '../utils/presets';
import { MasteringParams } from '../hooks/useAudioEngine';
import { motion, AnimatePresence } from 'motion/react';
import { createPreset, deletePreset, listPresets } from '../lib/dataService';

interface PresetManagerProps {
  currentParams: MasteringParams;
  onLoadPreset: (params: MasteringParams) => void;
  accentClass: string;
  accentBg: string;
}

export function PresetManager({ currentParams, onLoadPreset, accentClass, accentBg }: PresetManagerProps) {
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);
  const [selectedId, setSelectedId] = useState<string>('default');
  const [isSaving, setIsSaving] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCustomPresets();
  }, []);

  const fetchCustomPresets = async () => {
    try {
      const { presets } = await listPresets();
      const formattedCustoms: Preset[] = presets.map((p) => ({
        id: p.id,
        name: p.name,
        isCustom: p.isCustom ?? true,
        params: p.params,
      }));
      setPresets([...DEFAULT_PRESETS, ...formattedCustoms]);
      setStorageAvailable(true);
    } catch (e) {
      console.error('Failed to fetch user presets', e);
      setStorageAvailable(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showFeedback = (message: string) => {
    setFeedbackMessage(message);
    setTimeout(() => setFeedbackMessage(null), 3000);
  };

  const handleSave = async () => {
    if (!newPresetName.trim()) return;

    try {
      const { preset } = await createPreset(newPresetName.trim(), currentParams);
      await fetchCustomPresets();
      setSelectedId(preset.id);
      
      setNewPresetName('');
      setIsSaving(false);
      showFeedback('Preset Saved');
    } catch (e) {
      console.error('Error saving preset', e);
      setStorageAvailable(false);
      showFeedback('Save Error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePreset(id);

      setPresets(prev => prev.filter(p => p.id !== id));
      if (selectedId === id) {
        setSelectedId('default');
        onLoadPreset(DEFAULT_PRESETS[0].params);
      }
      showFeedback('Preset Removed');
    } catch (e) {
      console.error('Error deleting preset', e);
      showFeedback('Delete Error');
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const preset = presets.find(p => p.id === id);
    if (preset) {
      onLoadPreset(preset.params);
    }
    setIsOpen(false);
  };

  const selectedPreset = presets.find(p => p.id === selectedId);

  return (
    <div className="flex items-center gap-2 relative">
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            /* MOVED: top-full mt-2 ensures it is not cut off by the rack panel overflow */
            className={`absolute top-full mt-4 left-0 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 shadow-2xl flex items-center gap-2 z-[100] min-w-[140px]`}
          >
            <Check size={14} className={accentClass} />
            <span className="text-[10px] font-mono uppercase tracking-wider">{feedbackMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {isSaving ? (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-200">
          <input
            type="text"
            value={newPresetName}
            onChange={e => setNewPresetName(e.target.value)}
            placeholder="PRESET NAME..."
            className="bg-black border border-zinc-700 text-zinc-300 text-xs font-mono uppercase tracking-wider rounded-sm px-3 py-1.5 w-32 focus:outline-none focus:border-zinc-500 transition-colors shadow-inner"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button onMouseDown={handleSave} className={`text-[10px] font-bold font-mono uppercase tracking-widest px-3 py-1.5 rounded-sm ${accentBg} text-black hover:opacity-90 transition-opacity shadow-lg`}>Save</button>
          <button onMouseDown={() => setIsSaving(false)} className="text-[10px] font-bold font-mono uppercase tracking-widest px-3 py-1.5 rounded-sm bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-700">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 animate-in fade-in duration-200">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center justify-between w-[160px] sm:w-[200px] bg-black border border-zinc-700 text-zinc-300 text-xs font-mono font-bold uppercase tracking-wider rounded-sm pl-3 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-600 hover:bg-zinc-900 transition-colors shadow-inner"
            >
              <span className="truncate pr-2">{selectedPreset?.name || 'SELECT PRESET'}</span>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="absolute top-full left-0 mt-2 w-full sm:w-[240px] bg-[#1a1a1a] border border-zinc-700 rounded-sm shadow-2xl overflow-hidden z-50"
                >
                  <div className="max-h-[300px] overflow-y-auto py-2 custom-scrollbar">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-widest">
                      Factory Presets
                    </div>
                    {presets.filter(p => !p.isCustom).map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(p.id)}
                        className={`w-full text-left px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors flex items-center justify-between
                          ${selectedId === p.id ? 'bg-zinc-800 text-zinc-100 border-l-2 border-current' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 border-l-2 border-transparent'}`}
                      >
                        <span className="truncate">{p.name}</span>
                        {selectedId === p.id && <Check size={14} className={accentClass} />}
                      </button>
                    ))}

                    {presets.some(p => p.isCustom) && (
                      <>
                        <div className="px-3 py-1.5 mt-2 text-[10px] font-bold text-zinc-500 font-mono uppercase tracking-widest border-t border-zinc-800/50 pt-3 flex items-center gap-2">
                          <Cloud size={10} /> User Presets
                        </div>
                        {presets.filter(p => p.isCustom).map(p => (
                          <div key={p.id} className="group flex items-center relative">
                            <button
                              onClick={() => handleSelect(p.id)}
                              className={`w-full text-left px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors flex items-center justify-between pr-10
                                ${selectedId === p.id ? 'bg-zinc-800 text-zinc-100 border-l-2 border-current' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 border-l-2 border-transparent'}`}
                            >
                              <span className="truncate">{p.name}</span>
                              {selectedId === p.id && <Check size={14} className={accentClass} />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(p.id);
                              }}
                              className="absolute right-2 p-1.5 rounded-sm text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => storageAvailable && setIsSaving(true)}
            disabled={!storageAvailable}
            className="p-1.5 rounded-sm bg-gradient-to-b from-zinc-700 to-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:from-zinc-600 hover:to-zinc-700 disabled:opacity-40 disabled:hover:text-zinc-300 disabled:hover:from-zinc-700 disabled:hover:to-zinc-800 transition-colors shadow-lg active:translate-y-[1px]"
            title={storageAvailable ? 'Save current settings' : 'Preset storage unavailable'}
          >
            <Save size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
