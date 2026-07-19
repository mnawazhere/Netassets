/**
 * On-device capture sources (spec §6): voice → transcript and image → OCR
 * text. RAW AUDIO AND IMAGES NEVER LEAVE THIS MODULE — callers only get
 * text, which they must pass through the structurer (which redacts).
 *
 * Native modules are resolved lazily and every call is guarded: inside
 * Expo Go (no native module) each capability reports unavailable instead
 * of crashing, so the sim keeps working while real capture ships in the
 * dev/Release builds.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import Constants, { ExecutionEnvironment } from 'expo-constants';

/** Expo Go can't host these native modules — even a caught require noisily
 *  console.errors from expo-modules-core (LogBox red overlay), so never
 *  attempt it there. Dev/Release builds pass this gate. */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type SpeechModule = typeof import('expo-speech-recognition');

function speech(): SpeechModule | null {
  if (IN_EXPO_GO) return null;
  try {
    const m = require('expo-speech-recognition') as SpeechModule;
    // Touching a native constant throws when the native side is absent.
    m.ExpoSpeechRecognitionModule.isRecognitionAvailable();
    return m;
  } catch {
    return null;
  }
}

export function voiceAvailable(): boolean {
  return speech() !== null;
}

/** Ask for mic + speech permissions; false = denied or unavailable. */
export async function ensureVoicePermissions(): Promise<boolean> {
  const m = speech();
  if (!m) return false;
  try {
    const res = await m.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

export interface VoiceSession {
  stop: () => void;
}

/** Start on-device recognition; emits growing transcripts via onTranscript,
 *  fires onEnd exactly once with the final text (or null on error/none). */
export function startVoiceCapture(
  onTranscript: (text: string) => void,
  onEnd: (finalText: string | null) => void
): VoiceSession | null {
  const m = speech();
  if (!m) return null;
  let latest = '';
  let ended = false;
  const subs = [
    m.ExpoSpeechRecognitionModule.addListener('result', (e: { results?: { transcript?: string }[] }) => {
      const t = e.results?.[0]?.transcript ?? '';
      if (t) {
        latest = t;
        onTranscript(t);
      }
    }),
    m.ExpoSpeechRecognitionModule.addListener('end', () => {
      if (ended) return;
      ended = true;
      subs.forEach((s) => s.remove());
      onEnd(latest.trim() === '' ? null : latest.trim());
    }),
    m.ExpoSpeechRecognitionModule.addListener('error', () => {
      if (ended) return;
      ended = true;
      subs.forEach((s) => s.remove());
      onEnd(latest.trim() === '' ? null : latest.trim());
    }),
  ];
  try {
    m.ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      // §6: transcription must stay on-device; raw audio never uploads.
      requiresOnDeviceRecognition: true,
      continuous: true,
    });
  } catch {
    subs.forEach((s) => s.remove());
    return null;
  }
  return {
    stop: () => {
      try {
        m.ExpoSpeechRecognitionModule.stop();
      } catch {
        // end/error listener still resolves the session
      }
    },
  };
}

/** Pick an image and OCR it on-device. Returns extracted text, null when
 *  cancelled/unavailable/empty. The image itself never leaves the device. */
export async function pickAndOcrImage(): Promise<string | null> {
  let picker: typeof import('expo-image-picker');
  try {
    picker = require('expo-image-picker');
  } catch {
    return null;
  }
  const perm = await picker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  if (IN_EXPO_GO) return null; // ML Kit OCR is native-only; see gate above
  try {
    const TextRecognition =
      (require('@react-native-ml-kit/text-recognition') as {
        default: { recognize: (uri: string) => Promise<{ text: string }> };
      }).default;
    const out = await TextRecognition.recognize(res.assets[0].uri);
    const text = out.text?.trim() ?? '';
    return text === '' ? null : text;
  } catch {
    return null; // native OCR missing (Expo Go) or unreadable image
  }
}
