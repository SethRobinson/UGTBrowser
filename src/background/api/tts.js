// src/background/api/tts.js
// Text-to-Speech API integrations (ElevenLabs and Google Cloud TTS)

export function normalizeElevenLabsModelId(modelId) {
  const replacements = {
    eleven_monolingual_v1: 'eleven_flash_v2',
    eleven_multilingual_v1: 'eleven_multilingual_v2',
    eleven_turbo_v2_5: 'eleven_flash_v2_5',
    eleven_turbo_v2: 'eleven_flash_v2'
  };
  return replacements[modelId] || modelId || 'eleven_multilingual_v2';
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * ElevenLabs TTS API call
 * Returns base64-encoded audio
 */
export async function fetchFromElevenLabs(text, voiceId, apiKey, modelId = "eleven_multilingual_v2") {
  if (!apiKey) throw new Error("ElevenLabs API key is required");
  if (!voiceId) throw new Error("Voice ID is required");
  
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const modelToUse = normalizeElevenLabsModelId(modelId);
  
  const requestBody = {
    text: text,
    model_id: modelToUse,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  };
  
  console.log(`ElevenLabs TTS request: voice=${voiceId}, model=${modelToUse}, text length=${text.length}`);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    let errorMessage = `ElevenLabs API error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.detail && errorData.detail.message) {
        errorMessage = errorData.detail.message;
      } else if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
      }
    } catch (e) {
      // Couldn't parse error response
    }
    throw new Error(errorMessage);
  }
  
  const audioBuffer = await response.arrayBuffer();
  const base64Audio = arrayBufferToBase64(audioBuffer);
  
  console.log(`ElevenLabs TTS response: audio size=${audioBuffer.byteLength} bytes`);
  
  return base64Audio;
}

/**
 * Google Cloud Text-to-Speech API call
 * Returns base64-encoded audio (already provided by Google's API)
 */
export async function fetchFromGoogleTTS(text, voiceId, apiKey, speakingRate = 1.0, pitch = 0) {
  if (!apiKey) throw new Error("Google Cloud API key is required");
  if (!voiceId) throw new Error("Voice ID is required");
  
  // Parse voice ID to get language code and voice name
  // Voice IDs are formatted like "en-US-Studio-O" or "en-US-Neural2-A"
  const parts = voiceId.split('-');
  let languageCode, voiceName;
  
  if (parts.length >= 3) {
    languageCode = parts.slice(0, 2).join('-'); // e.g., "en-US" or "cmn-CN"
    voiceName = voiceId; // Full voice ID is used as the voice name
  } else {
    throw new Error("Invalid voice ID format");
  }
  
  // Check if voice type supports pitch parameter
  // Studio and Journey voices do NOT support pitch
  const voiceType = voiceId.toLowerCase();
  const supportsPitch = !voiceType.includes('studio') && !voiceType.includes('journey');
  
  const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  
  const audioConfig = {
    audioEncoding: "MP3",
    speakingRate: speakingRate
  };
  
  // Only add pitch if the voice type supports it
  if (supportsPitch && pitch !== 0) {
    audioConfig.pitch = pitch;
  }
  
  const requestBody = {
    input: {
      text: text
    },
    voice: {
      languageCode: languageCode,
      name: voiceName
    },
    audioConfig: audioConfig
  };
  
  console.log(`Google TTS request: voice=${voiceName}, lang=${languageCode}, rate=${speakingRate}`);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    let errorMessage = `Google TTS API error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      }
    } catch (e) {
      // Couldn't parse error response
    }
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  
  // Google TTS returns audio content as base64-encoded string
  if (!data.audioContent) {
    throw new Error("No audio content in response");
  }
  
  console.log(`Google TTS response: received audio content`);
  
  return data.audioContent;
}
