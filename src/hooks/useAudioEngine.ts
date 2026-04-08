import { useState, useEffect, useRef, useCallback } from 'react';
import { audioBufferToWav, audioBufferToMp3 } from '../utils/exportUtils';
import { uploadTrack } from '../lib/dataService';

export interface MasteringParams {
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  compThreshold: number;
  compRatio: number;
  makeupGain: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverbDecay: number;
  reverbMix: number;
  saturationDrive: number;
  saturationMix: number;
}

const DEFAULT_PARAMS: MasteringParams = {
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compThreshold: -14,
  compRatio: 1.5,
  makeupGain: 0,
  delayTime: 0.3,
  delayFeedback: 0.2,
  delayMix: 0,
  reverbDecay: 1.5,
  reverbMix: 0,
  saturationDrive: 1,
  saturationMix: 0,
};

function generateImpulseResponse(ctx: BaseAudioContext, duration: number, decay: number) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const multiplier = Math.pow(1 - i / length, decay);
    left[i] = (Math.random() * 2 - 1) * multiplier;
    right[i] = (Math.random() * 2 - 1) * multiplier;
  }
  return impulse;
}

function makeDistortionCurve(amount: number) {
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  for (let i = 0; i < n_samples; ++i) {
    const x = i * 2 / n_samples - 1;
    curve[i] = Math.tanh(x * amount);
  }
  return curve;
}

export function useAudioEngine() {
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [params, setParams] = useState<MasteringParams>(DEFAULT_PARAMS);
  const [isExporting, setIsExporting] = useState(false);
  const [fileName, setFileName] = useState<string>('mastered_track');
  const [audioError, setAudioError] = useState<string | null>(null);

  const [queue, setQueue] = useState<File[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const eqLowRef = useRef<BiquadFilterNode | null>(null);
  const eqMidRef = useRef<BiquadFilterNode | null>(null);
  const eqHighRef = useRef<BiquadFilterNode | null>(null);
  
  const inputNodeRef = useRef<GainNode | null>(null);
  const saturationNodeRef = useRef<WaveShaperNode | null>(null);
  const saturationDryGainRef = useRef<GainNode | null>(null);
  const saturationWetGainRef = useRef<GainNode | null>(null);
  
  const dryGainRef = useRef<GainNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const feedbackGainRef = useRef<GainNode | null>(null);
  const delayWetGainRef = useRef<GainNode | null>(null);
  const convolverNodeRef = useRef<ConvolverNode | null>(null);
  const reverbWetGainRef = useRef<GainNode | null>(null);
  const prevReverbDecayRef = useRef<number>(DEFAULT_PARAMS.reverbDecay);

  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupGainRef = useRef<GainNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef<number>(0);

  const initializeAudioEngine = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume().catch((err) => {
          console.warn('Audio context resume was blocked', err);
        });
      }
      return audioContextRef.current;
    }

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      setAudioError('This browser does not support the Web Audio API.');
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContextCtor();
    } catch (err) {
      console.error('Failed to initialize audio engine', err);
      setAudioError('The browser blocked audio engine initialization. Try a current desktop browser.');
      return;
    }

    audioContextRef.current = ctx;
    setAudioContext(ctx);
    
    const inputNode = ctx.createGain();
    const saturationNode = ctx.createWaveShaper();
    saturationNode.curve = makeDistortionCurve(DEFAULT_PARAMS.saturationDrive);
    saturationNode.oversample = '4x';
    const saturationDryGain = ctx.createGain();
    const saturationWetGain = ctx.createGain();

    const eqL = ctx.createBiquadFilter(); eqL.type = 'lowshelf'; eqL.frequency.value = 150;
    const eqM = ctx.createBiquadFilter(); eqM.type = 'peaking'; eqM.frequency.value = 1000;
    const eqH = ctx.createBiquadFilter(); eqH.type = 'highshelf'; eqH.frequency.value = 4000;

    const dryGain = ctx.createGain();
    const delayNode = ctx.createDelay(5.0);
    const feedbackGain = ctx.createGain();
    const delayWetGain = ctx.createGain();
    const convolverNode = ctx.createConvolver();
    const reverbWetGain = ctx.createGain();
    
    const comp = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -0.1;
    
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    inputNode.connect(saturationDryGain);
    inputNode.connect(saturationNode);
    saturationNode.connect(saturationWetGain);
    saturationDryGain.connect(eqL);
    saturationWetGain.connect(eqL);
    eqL.connect(eqM); eqM.connect(eqH);
    eqH.connect(dryGain); eqH.connect(delayNode); eqH.connect(convolverNode);
    delayNode.connect(feedbackGain); feedbackGain.connect(delayNode); delayNode.connect(delayWetGain);
    convolverNode.connect(reverbWetGain);
    dryGain.connect(comp); delayWetGain.connect(comp); reverbWetGain.connect(comp);
    comp.connect(makeup); makeup.connect(limiter); limiter.connect(analyser);
    analyser.connect(ctx.destination);

    inputNodeRef.current = inputNode;
    saturationNodeRef.current = saturationNode;
    saturationDryGainRef.current = saturationDryGain;
    saturationWetGainRef.current = saturationWetGain;
    eqLowRef.current = eqL; eqMidRef.current = eqM; eqHighRef.current = eqH;
    dryGainRef.current = dryGain; delayNodeRef.current = delayNode;
    feedbackGainRef.current = feedbackGain; delayWetGainRef.current = delayWetGain;
    convolverNodeRef.current = convolverNode; reverbWetGainRef.current = reverbWetGain;
    compressorRef.current = comp; makeupGainRef.current = makeup;
    limiterRef.current = limiter; analyserRef.current = analyser;

    convolverNode.buffer = generateImpulseResponse(ctx, DEFAULT_PARAMS.reverbDecay, 2);
    setAudioError(null);
    return ctx;
  }, []);

  useEffect(() => {
    return () => {
      const ctx = audioContextRef.current;
      try {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (sourceNodeRef.current) {
          sourceNodeRef.current.onended = null;
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        }
        if (ctx && ctx.state !== 'closed') void ctx.close();
      } catch (err) {
        console.warn('Audio engine cleanup failed', err);
      }
    };
  }, []);

  useEffect(() => {
    if (!audioContext) return;
    try {
      if (saturationNodeRef.current) saturationNodeRef.current.curve = makeDistortionCurve(params.saturationDrive);
      if (saturationDryGainRef.current) saturationDryGainRef.current.gain.value = 1 - params.saturationMix;
      if (saturationWetGainRef.current) saturationWetGainRef.current.gain.value = params.saturationMix;
      if (eqLowRef.current) eqLowRef.current.gain.value = params.eqLow;
      if (eqMidRef.current) eqMidRef.current.gain.value = params.eqMid;
      if (eqHighRef.current) eqHighRef.current.gain.value = params.eqHigh;
      if (delayNodeRef.current) delayNodeRef.current.delayTime.value = params.delayTime;
      if (feedbackGainRef.current) feedbackGainRef.current.gain.value = params.delayFeedback;
      if (delayWetGainRef.current) delayWetGainRef.current.gain.value = params.delayMix;
      if (reverbWetGainRef.current) reverbWetGainRef.current.gain.value = params.reverbMix;
      if (convolverNodeRef.current && prevReverbDecayRef.current !== params.reverbDecay) {
        convolverNodeRef.current.buffer = generateImpulseResponse(audioContext, params.reverbDecay, 2);
        prevReverbDecayRef.current = params.reverbDecay;
      }
      if (compressorRef.current) {
        compressorRef.current.threshold.value = params.compThreshold;
        compressorRef.current.ratio.value = params.compRatio;
      }
      if (makeupGainRef.current) makeupGainRef.current.gain.value = Math.pow(10, params.makeupGain / 20);
    } catch (err) {
      console.error('Failed to update audio parameters', err);
      setAudioError('Audio controls could not be applied in this browser session.');
    }
  }, [params, audioContext]);

  const updateProgress = useCallback(() => {
    if (!audioContext || !isPlaying) return;
    const time = audioContext.currentTime - startTimeRef.current;
    if (time >= duration) {
      setCurrentTime(duration);
      setIsPlaying(false);
      pauseTimeRef.current = 0;
      return;
    }
    setCurrentTime(time);
    if (typeof window !== 'undefined') {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [audioContext, isPlaying, duration]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
    }
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, updateProgress]);

  const addToQueue = async (files: FileList) => {
    const ctx = await initializeAudioEngine();
    if (!ctx) {
      setAudioError(prev => prev || 'Audio engine could not be started.');
      return;
    }

    const newFiles = Array.from(files);
    if (newFiles.length === 0) return;

    if (currentIndex === -1) {
      const loaded = await loadAudio(newFiles[0], ctx);
      if (!loaded) return;
      setQueue(prev => [...prev, ...newFiles]);
      setCurrentIndex(0);
      return;
    }

    setQueue(prev => [...prev, ...newFiles]);
  };

  const removeFromQueue = (index: number) => {
    setQueue(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (index === currentIndex) {
        stop();
        setCurrentIndex(-1);
      } else if (index < currentIndex) {
        setCurrentIndex(currentIndex - 1);
      }
      return updated;
    });
  };

  const loadAudio = async (file: File, ctx = audioContextRef.current): Promise<boolean> => {
    if (!ctx) {
      setAudioError('Audio engine is not ready yet.');
      return false;
    }

    try {
      stop();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      setDuration(buffer.duration);
      setCurrentTime(0);
      pauseTimeRef.current = 0;
      setFileName(file.name.replace(/\.[^/.]+$/, ""));
      setAudioError(null);
      return true;
    } catch (err) {
      console.error('Failed to load audio file', err);
      setAudioBuffer(null);
      setDuration(0);
      setCurrentTime(0);
      setAudioError('That file could not be decoded as browser-supported audio.');
      return false;
    }
  };

  const play = async () => {
    const ctx = await initializeAudioEngine();
    if (!ctx || !audioBuffer || !inputNodeRef.current) return;

    try {
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(inputNodeRef.current);
      
      source.onended = () => {
        if (sourceNodeRef.current === source) {
          setIsPlaying(false);
          if (currentIndex !== -1 && currentIndex < queue.length - 1) {
            const nextIdx = currentIndex + 1;
            setCurrentIndex(nextIdx);
            void loadAudio(queue[nextIdx]);
          }
        }
      };

      source.start(0, pauseTimeRef.current);
      startTimeRef.current = ctx.currentTime - pauseTimeRef.current;
      sourceNodeRef.current = source;
      setIsPlaying(true);
    } catch (err) {
      console.error('Playback failed', err);
      setIsPlaying(false);
      setAudioError('Playback failed. Try reloading the audio file.');
    }
  };

  const pause = () => {
    const ctx = audioContextRef.current;
    if (!ctx || !sourceNodeRef.current) return;
    try {
      sourceNodeRef.current.stop();
      pauseTimeRef.current = ctx.currentTime - startTimeRef.current;
    } catch (err) {
      console.warn('Pause failed', err);
    } finally {
      setIsPlaying(false);
    }
  };

  const stop = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch (err) {
        console.warn('Stop failed', err);
      } finally {
        sourceNodeRef.current = null;
      }
    }
    setIsPlaying(false);
    pauseTimeRef.current = 0;
    setCurrentTime(0);
  };

  const seek = (time: number) => {
    const wasPlaying = isPlaying;
    if (wasPlaying) stop();
    pauseTimeRef.current = time;
    setCurrentTime(time);
    if (wasPlaying) void play();
  };

  const exportTrack = async (format: 'wav' | 'mp3' = 'wav', bitrate: number = 320) => {
    if (!audioBuffer) return;
    setIsExporting(true);
    try {
      if (typeof OfflineAudioContext === 'undefined') {
        throw new Error('Offline rendering is not supported in this browser.');
      }

      const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      const input = offlineCtx.createGain();
      const saturation = offlineCtx.createWaveShaper();
      saturation.curve = makeDistortionCurve(params.saturationDrive);
      const satDry = offlineCtx.createGain(); satDry.gain.value = 1 - params.saturationMix;
      const satWet = offlineCtx.createGain(); satWet.gain.value = params.saturationMix;

      const eqL = offlineCtx.createBiquadFilter(); eqL.type = 'lowshelf'; eqL.frequency.value = 150; eqL.gain.value = params.eqLow;
      const eqM = offlineCtx.createBiquadFilter(); eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.gain.value = params.eqMid;
      const eqH = offlineCtx.createBiquadFilter(); eqH.type = 'highshelf'; eqH.frequency.value = 4000; eqH.gain.value = params.eqHigh;

      const dry = offlineCtx.createGain();
      const delay = offlineCtx.createDelay(5.0); delay.delayTime.value = params.delayTime;
      const feed = offlineCtx.createGain(); feed.gain.value = params.delayFeedback;
      const delWet = offlineCtx.createGain(); delWet.gain.value = params.delayMix;

      const conv = offlineCtx.createConvolver();
      conv.buffer = generateImpulseResponse(offlineCtx, params.reverbDecay, 2);
      const reverbWetGain = offlineCtx.createGain(); reverbWetGain.gain.value = params.reverbMix;

      const comp = offlineCtx.createDynamicsCompressor();
      comp.threshold.value = params.compThreshold; comp.ratio.value = params.compRatio;
      const makeup = offlineCtx.createGain(); makeup.gain.value = Math.pow(10, params.makeupGain / 20);
      const limit = offlineCtx.createDynamicsCompressor(); limit.threshold.value = -0.1; limit.ratio.value = 20;

      source.connect(input);
      input.connect(satDry); input.connect(saturation); saturation.connect(satWet);
      satDry.connect(eqL); satWet.connect(eqL); eqL.connect(eqM); eqM.connect(eqH);
      eqH.connect(dry); eqH.connect(delay); eqH.connect(conv);
      delay.connect(feed); feed.connect(delay); delay.connect(delWet); conv.connect(reverbWetGain);
      dry.connect(comp); delWet.connect(comp); reverbWetGain.connect(comp);
      comp.connect(makeup); makeup.connect(limit); limit.connect(offlineCtx.destination);

      source.start(0);
      const renderedBuffer = await offlineCtx.startRendering();
      
      const blob = format === 'mp3' ? audioBufferToMp3(renderedBuffer, bitrate) : audioBufferToWav(renderedBuffer);
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}_mastered.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      try {
        await uploadTrack(blob, {
          fileName,
          format,
          durationSeconds: audioBuffer.duration,
        });
        window.dispatchEvent(new CustomEvent('trackmaster:tracks-changed'));
      } catch (storageError) {
        console.warn("Local backup failed, but local download succeeded.", storageError);
      }

    } catch (err) {
      console.error("Export failed", err);
      setAudioError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return {
    loadAudio, play, pause, stop, seek, exportTrack,
    addToQueue, removeFromQueue,
    isPlaying, currentTime, duration, params, setParams,
    analyser: analyserRef.current,
    audioReady: !!audioContext,
    hasAudio: !!audioBuffer,
    isExporting, fileName, queue, currentIndex, audioError
  };
}
