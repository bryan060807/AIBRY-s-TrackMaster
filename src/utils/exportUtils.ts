import lameJsSource from 'lamejs/lame.all.js?raw';

type Mp3EncoderInstance = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
};

type Mp3EncoderConstructor = new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance;

let Mp3Encoder: Mp3EncoderConstructor | null = null;

function getMp3Encoder() {
  if (Mp3Encoder) return Mp3Encoder;

  try {
    const loadLameJs = new Function(`${lameJsSource}\nreturn lamejs;`) as () => { Mp3Encoder?: Mp3EncoderConstructor };
    const lamejs = loadLameJs();
    if (!lamejs?.Mp3Encoder) {
      throw new Error('Mp3Encoder was not exported.');
    }
    Mp3Encoder = lamejs.Mp3Encoder;
    return Mp3Encoder;
  } catch (err) {
    console.error('Failed to initialize MP3 encoder', err);
    throw new Error('MP3 encoder could not be initialized in this browser.');
  }
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const resultBuffer = new ArrayBuffer(44 + buffer.length * numChannels * 2);
  const view = new DataView(resultBuffer);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * numChannels * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, buffer.length * numChannels * 2, true);
  
  // Write audio data
  const offset = 44;
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }
  
  let pos = offset;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channelData[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
  }
  
  return new Blob([resultBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function audioBufferToMp3(buffer: AudioBuffer, kbps: number): Blob {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const Encoder = getMp3Encoder();
  const encoder = new Encoder(channels, sampleRate, kbps);
  const mp3Data: BlobPart[] = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;

  const sampleBlockSize = 1152;

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = floatToInt16(left.subarray(i, i + sampleBlockSize));
    const rightChunk = channels > 1 ? floatToInt16(right.subarray(i, i + sampleBlockSize)) : undefined;
    
    const mp3buf = channels > 1 
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
      
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const mp3buf = encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  if (mp3Data.length === 0) {
    throw new Error('MP3 encoding failed.');
  }

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

function floatToInt16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }

  return output;
}
