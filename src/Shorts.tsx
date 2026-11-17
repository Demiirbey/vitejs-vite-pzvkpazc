import './Shorts.css';
import { useEffect, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type Scene = { start: number; score: number };

type ShortVideo = {
  url: string;
  name: string;
  start: number;
  score: number;
  title: string;
  description: string;
};

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

const AI_MODEL_URL =
  'https://huggingface.co/Saimon8420/realesr-general-x4v3-web/resolve/main/realesr-general-x4v3-static384.onnx';

const MAX_SHORTS = 5;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function getYouTubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    const validHost = [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'www.youtu.be',
      'youtube-nocookie.com',
      'www.youtube-nocookie.com',
    ].includes(host);

    if (!validHost) return null;

    let id = '';

    if (host.includes('youtu.be')) {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else {
      id =
        url.searchParams.get('v') ||
        url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ||
        '';
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;

    return `https://www.youtube.com/embed/${id}?rel=0&playsinline=1`;
  } catch {
    return null;
  }
}

function generateMetadata(index: number, score: number) {
  const titles = [
    'Bu anı kaçırma! 🔥',
    'Videonun dikkat çeken bölümü! 👀',
    'İzlemeye değer bir an! 🎬',
    'Bu kısa videoya göz at! ⚡',
    'Videonun en hareketli anlarından biri! 🚀',
  ];

  let title = titles[index % titles.length];

  if (score >= 40) title = 'Bu an gerçekten dikkat çekiyor! 🔥';
  else if (score >= 25) title = 'Videonun hareketli anı! ⚡';

  return {
    title,
    description:
      'Bu kısa video Demivra Shorts ile hazırlandı.\n\n' +
      'Daha fazla video için takip etmeyi unutma!\n\n' +
      '#Shorts #Demivra #Video #Keşfet',
  };
}

function waitForSeek(element: HTMLVideoElement, time: number): Promise<void> {
  if (element.readyState >= 2 && Math.abs(element.currentTime - time) < 0.01) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video karesine erişilemedi.'));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener('seeked', onReady);
      element.removeEventListener('loadeddata', onReady);
      element.removeEventListener('error', onError);
    };

    const onReady = () => {
      if (
        element.readyState >= 2 &&
        Math.abs(element.currentTime - time) < 0.05
      ) {
        cleanup();
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error('Video okunurken hata oluştu.'));
    };

    element.addEventListener('seeked', onReady);
    element.addEventListener('loadeddata', onReady);
    element.addEventListener('error', onError);
    element.currentTime = time;
    onReady();
  });
}

function chooseScenes(
  scores: Scene[],
  length: number,
  selectedSeconds: number
): Scene[] {
  const clipLength = Math.min(selectedSeconds, length);

  if (!scores.length || length <= 0) {
    return [{ start: 0, score: 0 }];
  }

  const possibleClips = Math.max(1, Math.floor(length / clipLength));
  const slotLength = length / possibleClips;
  const candidates: Scene[] = [];

  for (let slot = 0; slot < possibleClips; slot++) {
    const slotStart = slot * slotLength;
    const slotEnd = (slot + 1) * slotLength;
    const earliestStart = slotStart;
    const latestStart = Math.max(earliestStart, slotEnd - clipLength);
    const possibleStarts: number[] = [];

    for (let start = earliestStart; start <= latestStart + 0.001; start += 1) {
      possibleStarts.push(start);
    }

    if (!possibleStarts.some((start) => Math.abs(start - latestStart) < 0.01)) {
      possibleStarts.push(latestStart);
    }

    let bestScene: Scene | null = null;

    for (const start of possibleStarts) {
      const windowScores = scores
        .filter(
          (item) => item.start >= start && item.start < start + clipLength
        )
        .map((item) => item.score)
        .sort((a, b) => b - a);

      if (!windowScores.length) continue;

      const average =
        windowScores.reduce((sum, value) => sum + value, 0) /
        windowScores.length;

      const topCount = Math.max(1, Math.ceil(windowScores.length * 0.25));
      const peakAverage =
        windowScores.slice(0, topCount).reduce((sum, value) => sum + value, 0) /
        topCount;

      const finalScore = average * 0.65 + peakAverage * 0.35;

      if (!bestScene || finalScore > bestScene.score) {
        bestScene = { start, score: finalScore };
      }
    }

    candidates.push(bestScene || { start: earliestStart, score: 0 });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SHORTS)
    .sort((a, b) => a.start - b.start);
}

function Shorts() {
  const [clipSeconds, setClipSeconds] = useState(30);
  const [outputHeight, setOutputHeight] = useState(1280);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const enginePromiseRef = useRef<Promise<FFmpeg> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputUrlsRef = useRef<string[]>([]);

  const [video, setVideo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [youtubeEmbed, setYoutubeEmbed] = useState('');
  const [duration, setDuration] = useState(0);
  const [outputs, setOutputs] = useState<ShortVideo[]>([]);
  const [message, setMessage] = useState(
    'Bilgisayarından video seçerek başlayabilirsin.'
  );
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState(
    'Önce bir video yükle. Ardından tek karelik AI testini çalıştır.'
  );
  const [aiBefore, setAiBefore] = useState('');
  const [aiAfter, setAiAfter] = useState('');
  const [aiBackend, setAiBackend] = useState('');
  const [aiProgress, setAiProgress] = useState(0);
  const aiSessionRef = useRef<any>(null);
  const aiBackendRef = useRef('');

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      outputUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function clearOutputs() {
    outputUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    outputUrlsRef.current = [];
    setOutputs([]);
  }

  function clearAiResults() {
    setAiBefore('');
    setAiAfter('');
    setAiBackend('');
    setAiProgress(0);
    setAiMessage('Yeni video için AI testi hazır.');
  }

  function selectVideo(file: File) {
    if (!file.type.startsWith('video/')) {
      setMessage('Lütfen geçerli bir video dosyası seç.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setMessage('Dosya boyutu 1 GB sınırını aşıyor.');
      return;
    }

    const newUrl = URL.createObjectURL(file);

    setVideo(file);
    setPreviewUrl(newUrl);
    setYoutubeEmbed('');
    setDuration(0);
    clearOutputs();
    clearAiResults();
    setProgress(0);
    setMessage('Video yüklendi. Süresi okunuyor...');

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleMetadata() {
    const value = videoRef.current?.duration || 0;

    if (Number.isFinite(value) && value > 0) {
      setDuration(value);
      setMessage('Video hazır. Shorts oluşturabilirsin.');
    } else {
      setMessage('Video süresi okunamadı. Başka bir video deneyebilirsin.');
    }
  }

  async function loadEngine(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (enginePromiseRef.current) return enginePromiseRef.current;

    const promise = (async () => {
      setMessage('Video motoru hazırlanıyor. İlk açılış biraz sürebilir...');

      const ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress: value }) => {
        if (Number.isFinite(value)) {
          setProgress((old) =>
            Math.max(old, Math.min(99, Math.round(value * 100)))
          );
        }
      });

      const coreURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.js`,
        'text/javascript'
      );

      const wasmURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.wasm`,
        'application/wasm'
      );

      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegRef.current = ffmpeg;
      setEngineReady(true);
      return ffmpeg;
    })();

    enginePromiseRef.current = promise;

    try {
      return await promise;
    } catch (error) {
      enginePromiseRef.current = null;
      throw error;
    }
  }

  async function analyzeVideo(file: File, length: number): Promise<Scene[]> {
    setMessage('Sahneler analiz ediliyor...');

    const temporaryUrl = URL.createObjectURL(file);
    const sampleVideo = document.createElement('video');

    sampleVideo.preload = 'auto';
    sampleVideo.muted = true;
    sampleVideo.playsInline = true;

    try {
      await new Promise<void>((resolve, reject) => {
        sampleVideo.onloadedmetadata = () => resolve();
        sampleVideo.onerror = () =>
          reject(new Error('Video analiz için açılamadı.'));
        sampleVideo.src = temporaryUrl;
        sampleVideo.load();
      });

      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 54;

      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Görüntü analiz alanı oluşturulamadı.');

      const samples: { time: number; pixels: Uint8ClampedArray }[] = [];
      const sampleCount = Math.max(2, Math.min(900, Math.ceil(length)));

      for (let second = 0; second < sampleCount; second++) {
        const time = Math.min(
          (second / sampleCount) * length,
          Math.max(0, length - 0.1)
        );
        await waitForSeek(sampleVideo, time);
        context.drawImage(sampleVideo, 0, 0, 96, 54);

        const pixels = context.getImageData(0, 0, 96, 54).data;
        samples.push({ time, pixels: new Uint8ClampedArray(pixels) });

        if (second % 5 === 0) {
          setProgress(Math.round((second / sampleCount) * 30));
        }
      }

      const scores: Scene[] = [];

      for (let i = 1; i < samples.length; i++) {
        const previous = samples[i - 1].pixels;
        const current = samples[i].pixels;
        let difference = 0;

        for (let p = 0; p < current.length; p += 4) {
          const oldBrightness =
            previous[p] * 0.299 +
            previous[p + 1] * 0.587 +
            previous[p + 2] * 0.114;

          const newBrightness =
            current[p] * 0.299 +
            current[p + 1] * 0.587 +
            current[p + 2] * 0.114;

          difference += Math.abs(newBrightness - oldBrightness);
        }

        scores.push({ start: samples[i].time, score: difference / (96 * 54) });
      }

      return scores;
    } finally {
      sampleVideo.removeAttribute('src');
      sampleVideo.load();
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  async function loadAiSession() {
    if (aiSessionRef.current) return aiSessionRef.current;

    setAiMessage(
      'AI modeli yükleniyor. İlk kullanımda birkaç MB indirilecek...'
    );
    setAiProgress(10);

    try {
      const ort = await import('onnxruntime-web/webgpu');

      try {
        const session = await ort.InferenceSession.create(AI_MODEL_URL, {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
        });

        aiSessionRef.current = { session, ort };
        aiBackendRef.current = 'WebGPU';
        setAiBackend('WebGPU');
        return aiSessionRef.current;
      } catch (gpuError) {
        console.warn('WebGPU başlatılamadı, WASM deneniyor:', gpuError);
      }
    } catch (importError) {
      console.warn('WebGPU modülü yüklenemedi:', importError);
    }

    setAiMessage('WebGPU kullanılamadı. WASM işlemcisi deneniyor...');
    setAiProgress(20);

    const ort = await import('onnxruntime-web');

    const session = await ort.InferenceSession.create(AI_MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    aiSessionRef.current = { session, ort };
    aiBackendRef.current = 'WASM';
    setAiBackend('WASM');
    return aiSessionRef.current;
  }

  async function runAiFrameTest() {
    if (!video || !duration) {
      setAiMessage('Önce bilgisayarından bir video yüklemelisin.');
      return;
    }

    const sourceVideo = videoRef.current;

    if (!sourceVideo || !sourceVideo.videoWidth || !sourceVideo.videoHeight) {
      setAiMessage(
        'Video henüz hazır değil. Birkaç saniye bekleyip tekrar dene.'
      );
      return;
    }

    setAiLoading(true);
    setAiProgress(0);
    setAiBefore('');
    setAiAfter('');
    setAiBackend('');

    try {
      setAiMessage('Videodan örnek kare alınıyor...');

      const sampleTime = Math.min(5, Math.max(0.2, duration / 2));
      await waitForSeek(sourceVideo, sampleTime);

      const size = 384;
      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = size;
      inputCanvas.height = size;

      const inputContext = inputCanvas.getContext('2d', {
        willReadFrequently: true,
      });

      if (!inputContext) throw new Error('Örnek görüntü oluşturulamadı.');

      const sourceWidth = sourceVideo.videoWidth;
      const sourceHeight = sourceVideo.videoHeight;
      const cropSize = Math.min(sourceWidth, sourceHeight);
      const cropX = (sourceWidth - cropSize) / 2;
      const cropY = (sourceHeight - cropSize) / 2;

      inputContext.drawImage(
        sourceVideo,
        cropX,
        cropY,
        cropSize,
        cropSize,
        0,
        0,
        size,
        size
      );

      setAiBefore(inputCanvas.toDataURL('image/jpeg', 0.9));
      setAiProgress(15);

      const { session, ort } = await loadAiSession();

      setAiMessage(
        'AI modeli çalışıyor. Bu işlem bilgisayarının gücüne bağlı olarak sürebilir...'
      );
      setAiProgress(35);

      const imageData = inputContext.getImageData(0, 0, size, size).data;
      const planeSize = size * size;
      const inputData = new Float32Array(3 * planeSize);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pixel = y * size + x;
          const rgbaIndex = pixel * 4;

          inputData[pixel] = imageData[rgbaIndex] / 255;
          inputData[planeSize + pixel] = imageData[rgbaIndex + 1] / 255;
          inputData[2 * planeSize + pixel] = imageData[rgbaIndex + 2] / 255;
        }
      }

      const tensor = new ort.Tensor('float32', inputData, [1, 3, 384, 384]);
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];

      const result = await session.run({ [inputName]: tensor });
      const output = result[outputName];

      if (!output || !output.data) {
        throw new Error('AI modelinden görüntü sonucu alınamadı.');
      }

      setAiProgress(85);
      setAiMessage('AI sonucu görüntüye dönüştürülüyor...');

      const outputSize = 1536;
      const outputPixels = output.data as Float32Array;
      const outputPlane = outputSize * outputSize;
      const rgba = new Uint8ClampedArray(outputPlane * 4);

      if (outputPixels.length < outputPlane * 3) {
        throw new Error('AI modeli beklenen boyutta çıktı üretmedi.');
      }

      for (let i = 0; i < outputPlane; i++) {
        rgba[i * 4] = Math.max(
          0,
          Math.min(255, Math.round(outputPixels[i] * 255))
        );
        rgba[i * 4 + 1] = Math.max(
          0,
          Math.min(255, Math.round(outputPixels[outputPlane + i] * 255))
        );
        rgba[i * 4 + 2] = Math.max(
          0,
          Math.min(255, Math.round(outputPixels[2 * outputPlane + i] * 255))
        );
        rgba[i * 4 + 3] = 255;
      }

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = outputSize;
      outputCanvas.height = outputSize;

      const outputContext = outputCanvas.getContext('2d');
      if (!outputContext) throw new Error('AI sonucu ekrana aktarılamadı.');

      outputContext.putImageData(
        new ImageData(rgba, outputSize, outputSize),
        0,
        0
      );

      setAiAfter(outputCanvas.toDataURL('image/jpeg', 0.92));
      setAiProgress(100);
      setAiMessage(
        `AI testi başarılı! Örnek kare 384×384 boyutundan 1536×1536 boyutuna yükseltildi. Kullanılan altyapı: ${aiBackendRef.current}.`
      );
    } catch (error) {
      console.error('DEMIVRA AI TEST HATASI:', error);
      const detail =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      setAiMessage(`AI testi başarısız: ${detail}`);
      setAiProgress(0);
    } finally {
      setAiLoading(false);
    }
  }

  async function createShorts() {
    if (!video) {
      setMessage(
        'Shorts oluşturmak için önce video dosyasını yüklemelisin. YouTube önizlemesi tek başına dönüştürülemez.'
      );
      return;
    }

    if (!duration || !Number.isFinite(duration)) {
      setMessage('Video süresi henüz okunmadı.');
      return;
    }

    if (duration < 5) {
      setMessage('Video en az 5 saniye uzunluğunda olmalı.');
      return;
    }

    setLoading(true);
    setProgress(0);
    clearOutputs();

    const newUrls: string[] = [];
    let ffmpeg: FFmpeg | null = null;
    let inputName = '';
    const temporaryOutputNames: string[] = [];

    try {
      const scenes = await analyzeVideo(video, duration);

      if (!scenes.length) {
        throw new Error('Videoda analiz edilebilir sahne bulunamadı.');
      }

      setProgress(30);
      const selectedScenes = chooseScenes(scenes, duration, clipSeconds);

      setMessage(
        `${selectedScenes.length} farklı bölüm seçildi. Video motoru hazırlanıyor...`
      );

      ffmpeg = await loadEngine();

      const rawExtension = video.name.split('.').pop()?.toLowerCase() || 'mp4';
      const extension = /^[a-z0-9]{1,8}$/.test(rawExtension)
        ? rawExtension
        : 'mp4';
      inputName = `input.${extension}`;

      await ffmpeg.writeFile(inputName, await fetchFile(video));

      const results: ShortVideo[] = [];
      const outputWidth = Math.round((outputHeight * 9) / 16);

      for (let i = 0; i < selectedScenes.length; i++) {
        const scene = selectedScenes[i];
        const outputName = `demivra_${i + 1}.mp4`;
        temporaryOutputNames.push(outputName);
        const clipLength = Math.min(clipSeconds, duration - scene.start);

        const quality =
          outputHeight >= 2160
            ? '4K'
            : outputHeight >= 1440
            ? '2K'
            : outputHeight >= 1080
            ? '1080p'
            : '720p';

        setMessage(
          `${i + 1}/${
            selectedScenes.length
          } Shorts hazırlanıyor... (${quality})`
        );

        const exitCode = await ffmpeg.exec([
          '-ss',
          String(scene.start),
          '-i',
          inputName,
          '-t',
          String(clipLength),
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-vf',
          `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputWidth}:${outputHeight},setsar=1,unsharp=5:5:0.7:3:3:0.3`,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputName,
        ]);

        if (exitCode !== 0) {
          throw new Error(
            `FFmpeg ${i + 1}. videoyu oluşturamadı (çıkış kodu: ${exitCode}).`
          );
        }

        const data = await ffmpeg.readFile(outputName);

        if (typeof data === 'string') {
          throw new Error('Oluşturulan video okunamadı.');
        }

        const videoBuffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(videoBuffer).set(data);
        const blob = new Blob([videoBuffer], { type: 'video/mp4' });

        const url = URL.createObjectURL(blob);
        newUrls.push(url);

        const metadata = generateMetadata(i, scene.score);

        results.push({
          url,
          name: `demivra-shorts-${i + 1}.mp4`,
          start: scene.start,
          score: scene.score,
          title: metadata.title,
          description: metadata.description,
        });

        await ffmpeg.deleteFile(outputName);
        setProgress(30 + Math.round(((i + 1) / selectedScenes.length) * 70));
      }

      outputUrlsRef.current = newUrls;
      setOutputs(results);
      setMessage(`${results.length} Shorts başarıyla oluşturuldu!`);
      setProgress(100);
    } catch (error) {
      console.error('DEMIVRA GERÇEK HATA:', error);
      newUrls.forEach((url) => URL.revokeObjectURL(url));
      const detail =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      setMessage(`İşlem başarısız: ${detail}`);
      setProgress(0);
    } finally {
      if (ffmpeg) {
        for (const temporaryName of temporaryOutputNames) {
          try {
            await ffmpeg.deleteFile(temporaryName);
          } catch {
            // Geçici dosya zaten silinmiş olabilir.
          }
        }

        if (inputName) {
          try {
            await ffmpeg.deleteFile(inputName);
          } catch {
            // Girdi dosyası zaten silinmiş olabilir.
          }
        }
      }

      setLoading(false);
    }
  }

  async function loadDirectVideoUrl() {
    const address = videoUrl.trim();

    if (!address) {
      setMessage('Önce video bağlantısı gir.');
      return;
    }

    const youtubeUrl = getYouTubeEmbedUrl(address);

    if (youtubeUrl) {
      setYoutubeEmbed(youtubeUrl);
      setVideo(null);
      setPreviewUrl('');
      setDuration(0);
      clearOutputs();
      clearAiResults();
      setMessage(
        'YouTube bağlantısı tanındı. Önizleme yükleniyor. Dönüştürmek için video dosyasına erişmen gerekir.'
      );
      return;
    }

    if (/youtube\.com|youtu\.be/i.test(address)) {
      setMessage(
        'YouTube bağlantısı tanınamadı. Geçerli bir video bağlantısı kullan.'
      );
      return;
    }

    try {
      new URL(address);
    } catch {
      setMessage('Geçerli bir internet bağlantısı gir.');
      return;
    }

    setLoading(true);
    setMessage('Doğrudan video bağlantısı kontrol ediliyor...');

    try {
      const response = await fetch(address);

      if (!response.ok) throw new Error('Bağlantıdan video alınamadı.');

      const type = response.headers.get('content-type') || '';

      if (!type.startsWith('video/') && !type.includes('octet-stream')) {
        throw new Error('Bu bağlantı doğrudan video dosyası değil.');
      }

      const blob = await response.blob();

      if (!blob.size) throw new Error('Video dosyası boş.');
      if (blob.size > MAX_FILE_SIZE)
        throw new Error('Video 1 GB sınırını aşıyor.');

      const extension = type.includes('webm')
        ? 'webm'
        : type.includes('quicktime')
        ? 'mov'
        : 'mp4';

      const file = new File([blob], `demivra-video.${extension}`, {
        type: type.startsWith('video/') ? type : 'video/mp4',
      });

      setYoutubeEmbed('');
      selectVideo(file);
      setMessage('Video bağlantıdan başarıyla alındı.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Bilinmeyen hata';
      setMessage(
        `${detail} Kaynak sunucu CORS erişimine izin vermiyor olabilir. Videoyu bilgisayarından yüklemeyi deneyebilirsin.`
      );
    } finally {
      setLoading(false);
    }
  }

  function updateOutput(
    index: number,
    field: 'title' | 'description',
    value: string
  ) {
    setOutputs((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Metin panoya kopyalandı.');
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();

        if (!copied) throw new Error('Kopyalanamadı.');
        setMessage('Metin panoya kopyalandı.');
      } catch {
        setMessage('Kopyalama başarısız. Metni seçerek kopyalayabilirsin.');
      }
    }
  }

  const resolutionLabel =
    outputHeight === 3840
      ? '2160p 4K'
      : outputHeight === 2560
      ? '1440p 2K'
      : outputHeight === 1920
      ? '1080p Full HD'
      : '720p HD';

  return (
    <div className="demivra-shorts">
      <header className="topbar">
        <div className="logo">
          DEMIVRA <span>SHORTS</span>
        </div>
        <div className="pill">ÜCRETSİZ KULLANIM</div>
      </header>

      <section className="hero">
        <div className="tag">YENİ NESİL VİDEO DÖNÜŞTÜRÜCÜ</div>
        <h1>
          Videonu yükle.
          <br />
          <span className="gradient">Shorts'a dönüştür.</span>
        </h1>
        <p className="description">
          Uzun videolarından kısa ve dikey videolar oluştur.
          <br />
          Analiz et, dönüştür, önizle ve indir.
        </p>
      </section>

      <main className="panel">
        <h2>Video dönüştürücü</h2>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            Shorts video süresi
          </label>
          <select
            value={clipSeconds}
            onChange={(event) => setClipSeconds(Number(event.target.value))}
            disabled={loading}
            style={{
              width: '100%',
              padding: 14,
              color: 'white',
              background: '#080d19',
              border: '1px solid #7564ed',
              borderRadius: 10,
            }}
          >
            <option value={30}>30 saniye</option>
            <option value={40}>40 saniye</option>
            <option value={50}>50 saniye</option>
            <option value={60}>60 saniye</option>
          </select>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            Çıktı video kalitesi
          </label>
          <select
            value={outputHeight}
            onChange={(event) => setOutputHeight(Number(event.target.value))}
            disabled={loading}
            style={{
              width: '100%',
              padding: 14,
              color: 'white',
              background: '#080d19',
              border: '1px solid #7564ed',
              borderRadius: 10,
            }}
          >
            <option value={1280}>720p HD</option>
            <option value={1920}>1080p Full HD</option>
            <option value={2560}>1440p 2K</option>
            <option value={3840}>2160p 4K</option>
          </select>
          <p className="muted">
            Görüntü seçilen çözünürlüğe ölçeklendirilir ve keskinleştirme
            uygulanır. 4K işlem daha fazla bellek ve işlem gücü gerektirir.
          </p>
        </div>

        <p className="muted">
          Bilgisayarından video seç veya doğrudan video dosyası bağlantısı gir.
          YouTube bağlantısını da önizleyebilirsin.
        </p>

        <label className="upload">
          <strong>＋ Bilgisayarından video seç</strong>
          <span>
            MP4, MOV, WEBM ve tarayıcının desteklediği video formatları
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) selectVideo(file);
            }}
          />
        </label>

        <div className="or">VEYA VİDEO / YOUTUBE BAĞLANTISI</div>

        <div className="urlrow">
          <input
            type="text"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="YouTube veya doğrudan video bağlantısı..."
            disabled={loading}
          />
          <button onClick={loadDirectVideoUrl} disabled={loading}>
            Bağlantıyı aç
          </button>
        </div>

        {youtubeEmbed && (
          <>
            <iframe
              className="youtube-preview"
              src={youtubeEmbed}
              title="YouTube video önizlemesi"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <div className="youtube-note">
              ✓ YouTube bağlantısı tanındı.
              <br />
              Video önizlemesi YouTube oynatıcısı üzerinden gösterilir. Shorts
              oluşturmak için video dosyasını yüklemelisin.
            </div>
          </>
        )}

        {video && (
          <div className="selected">
            <strong>✓ Video seçildi:</strong> {video.name}
            <br />
            Süre: {duration > 0 ? formatTime(duration) : 'Okunuyor...'}
            <br />
            Boyut: {(video.size / (1024 * 1024)).toFixed(1)} MB
          </div>
        )}

        {previewUrl && (
          <video
            ref={videoRef}
            className="preview"
            src={previewUrl}
            controls
            playsInline
            onLoadedMetadata={handleMetadata}
          />
        )}

        <button
          className="mainbutton"
          onClick={createShorts}
          disabled={!video || !duration || loading}
        >
          {loading ? 'İŞLEM DEVAM EDİYOR...' : '✦ SHORTS OLUŞTUR'}
        </button>

        {loading && (
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="message">{message}</div>

        <p className="muted">
          {engineReady
            ? '✓ Video motoru hazır. Dönüştürmeye başlayabilirsin.'
            : 'Video dönüştürmek için bir video yükle ve SHORTS OLUŞTUR düğmesine bas. Motor otomatik hazırlanacaktır.'}
        </p>
      </main>

      <section className="ai-panel">
        <h2>✦ Demivra AI Görüntü İyileştirme Testi</h2>
        <p className="muted">
          Bu test, videondan tek bir kare alır ve Real-ESRGAN yapay zekâ
          modeliyle 4 kat büyütür. Henüz tüm videoyu işlemez.
        </p>
        <div className="ai-note">
          İlk kullanımda AI modeli internetten indirilir. WebGPU desteklenirse
          ekran kartı, desteklenmezse WASM işlemcisi kullanılmaya çalışılır.
          İşlem bilgisayarının gücüne göre zaman alabilir.
        </div>
        <button
          className="ai-button"
          onClick={runAiFrameTest}
          disabled={!video || !duration || aiLoading || loading}
        >
          {aiLoading
            ? 'AI TESTİ ÇALIŞIYOR...'
            : '✦ TEK KAREDE AI TESTİNİ BAŞLAT'}
        </button>
        {aiLoading && (
          <div className="ai-progress">
            <div style={{ width: `${aiProgress}%` }} />
          </div>
        )}
        <div className="ai-status">{aiMessage}</div>
        {aiBackend && (
          <span className="ai-backend">Çalışma altyapısı: {aiBackend}</span>
        )}

        {(aiBefore || aiAfter) && (
          <div className="ai-grid">
            {aiBefore && (
              <div className="ai-image-card">
                <strong>Orijinal kare · 384 × 384</strong>
                <img src={aiBefore} alt="Orijinal video karesi" />
              </div>
            )}
            {aiAfter && (
              <div className="ai-image-card">
                <strong>AI sonucu · 1536 × 1536</strong>
                <img src={aiAfter} alt="AI ile iyileştirilmiş video karesi" />
              </div>
            )}
          </div>
        )}
      </section>

      {outputs.length > 0 && (
        <section className="results">
          <h2>Oluşturulan Shorts videoları</h2>
          <p className="muted">
            Videolarını izle, MP4 olarak indir ve YouTube için başlık ve
            açıklamalarını düzenle.
          </p>

          <div className="grid">
            {outputs.map((item, index) => (
              <article className="clip" key={item.url}>
                <video src={item.url} controls playsInline />
                <h3>Shorts {index + 1}</h3>
                <p>
                  Başlangıç: {formatTime(item.start)}
                  <br />
                  Hareket puanı: {item.score.toFixed(2)}
                  <br />
                  Çözünürlük: {resolutionLabel}
                </p>

                <label className="metadata-label">YouTube başlığı</label>
                <input
                  className="metadata-input"
                  value={item.title}
                  maxLength={100}
                  onChange={(event) =>
                    updateOutput(index, 'title', event.target.value)
                  }
                />

                <div className="copy-row">
                  <button onClick={() => copyText(item.title)}>
                    Başlığı kopyala
                  </button>
                  <button
                    onClick={() =>
                      updateOutput(
                        index,
                        'title',
                        generateMetadata(index, item.score).title
                      )
                    }
                  >
                    Başlığı yenile
                  </button>
                </div>

                <label className="metadata-label">
                  YouTube açıklaması ve hashtagler
                </label>
                <textarea
                  className="metadata-textarea"
                  value={item.description}
                  onChange={(event) =>
                    updateOutput(index, 'description', event.target.value)
                  }
                />

                <button
                  className="copy-all"
                  onClick={() => copyText(item.description)}
                >
                  Açıklamayı kopyala
                </button>
                <button
                  className="copy-all"
                  onClick={() =>
                    copyText(`${item.title}\n\n${item.description}`)
                  }
                >
                  Başlık + açıklamayı birlikte kopyala
                </button>
                <a className="download" href={item.url} download={item.name}>
                  ↓ MP4 İNDİR
                </a>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="footer">
        © 2026 DEMIVRA SHORTS · İçeriklerinin kontrolü sende.
      </footer>
    </div>
  );
}

export default Shorts;
