
import { useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type Scene = { start: number; score: number };
type ShortVideo = {
  url: string;
  name: string;
  start: number;
  score: number;
  title: string;
  description: string;
};

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const AI_MODEL_URL =
  "https://huggingface.co/Saimon8420/realesr-general-x4v3-web/resolve/main/realesr-general-x4v3-static384.onnx";

const MAX_SHORTS = 5;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const AI_TEST_SECONDS = 5;
const AI_FPS = 10;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function getYouTubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const validHost = [
      "youtube.com", "www.youtube.com", "m.youtube.com",
      "music.youtube.com", "youtu.be", "www.youtu.be",
      "youtube-nocookie.com", "www.youtube-nocookie.com",
    ].includes(host);

    if (!validHost) return null;

    let id = "";
    if (host.includes("youtu.be")) {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else {
      id =
        url.searchParams.get("v") ||
        url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ||
        "";
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}?rel=0&playsinline=1`;
  } catch {
    return null;
  }
}

function generateMetadata(index: number, score: number) {
  const titles = [
    "Bu anı kaçırma! 🔥",
    "Videonun dikkat çeken bölümü! 👀",
    "İzlemeye değer bir an! 🎬",
    "Bu kısa videoya göz at! ⚡",
    "Videonun en hareketli anlarından biri! 🚀",
  ];

  let title = titles[index % titles.length];
  if (score >= 40) title = "Bu an gerçekten dikkat çekiyor! 🔥";
  else if (score >= 25) title = "Videonun hareketli anı! ⚡";

  return {
    title,
    description:
      "Bu kısa video Demivra Shorts ile hazırlandı.\n\n" +
      "Daha fazla video için takip etmeyi unutma!\n\n" +
      "#Shorts #Demivra #Video #Keşfet",
  };
}

function waitForSeek(element: HTMLVideoElement, time: number): Promise<void> {
  if (
    element.readyState >= 2 &&
    Math.abs(element.currentTime - time) < 0.01
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video karesine erişilemedi."));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener("seeked", onReady);
      element.removeEventListener("loadeddata", onReady);
      element.removeEventListener("error", onError);
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
      reject(new Error("Video okunurken hata oluştu."));
    };

    element.addEventListener("seeked", onReady);
    element.addEventListener("loadeddata", onReady);
    element.addEventListener("error", onError);
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
  if (!scores.length || length <= 0) return [{ start: 0, score: 0 }];

  const possibleClips = Math.max(1, Math.floor(length / clipLength));
  const slotLength = length / possibleClips;
  const candidates: Scene[] = [];

  for (let slot = 0; slot < possibleClips; slot++) {
    const slotStart = slot * slotLength;
    const slotEnd = (slot + 1) * slotLength;
    const latestStart = Math.max(slotStart, slotEnd - clipLength);
    const possibleStarts: number[] = [];

    for (let start = slotStart; start <= latestStart + 0.001; start += 1) {
      possibleStarts.push(start);
    }

    if (!possibleStarts.some((start) => Math.abs(start - latestStart) < 0.01)) {
      possibleStarts.push(latestStart);
    }

    let bestScene: Scene | null = null;

    for (const start of possibleStarts) {
      const windowScores = scores
        .filter((item) => item.start >= start && item.start < start + clipLength)
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

    candidates.push(bestScene || { start: slotStart, score: 0 });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SHORTS)
    .sort((a, b) => a.start - b.start);
}

async function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) resolve(value);
        else reject(new Error("Görüntü dosyası oluşturulamadı."));
      },
      "image/png"
    );
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function App() {
  const [clipSeconds, setClipSeconds] = useState(30);
  const [outputHeight, setOutputHeight] = useState(1280);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const enginePromiseRef = useRef<Promise<FFmpeg> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputUrlsRef = useRef<string[]>([]);

  const [video, setVideo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [youtubeEmbed, setYoutubeEmbed] = useState("");
  const [duration, setDuration] = useState(0);
  const [outputs, setOutputs] = useState<ShortVideo[]>([]);
  const [message, setMessage] = useState(
    "Bilgisayarından video seçerek başlayabilirsin."
  );
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  // Tek karelik AI testi
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState(
    "Önce bir video yükle. Ardından tek karelik AI testini çalıştır."
  );
  const [aiBefore, setAiBefore] = useState("");
  const [aiAfter, setAiAfter] = useState("");
  const [aiBackend, setAiBackend] = useState("");
  const [aiProgress, setAiProgress] = useState(0);
  const aiSessionRef = useRef<any>(null);
  const aiBackendRef = useRef("");

  // AI video işleme
  const [aiVideoLoading, setAiVideoLoading] = useState(false);
  const [aiVideoProgress, setAiVideoProgress] = useState(0);
  const [aiVideoMessage, setAiVideoMessage] = useState(
    "5 saniyelik AI video testi için hazır."
  );
  const [aiVideoUrl, setAiVideoUrl] = useState("");
  const [aiVideoName, setAiVideoName] = useState("demivra-ai-video.mp4");

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

  useEffect(() => {
    return () => {
      if (aiVideoUrl) URL.revokeObjectURL(aiVideoUrl);
    };
  }, [aiVideoUrl]);

  function clearOutputs() {
    outputUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    outputUrlsRef.current = [];
    setOutputs([]);
  }

  function clearAiResults() {
    setAiBefore("");
    setAiAfter("");
    setAiBackend("");
    setAiProgress(0);
    setAiMessage("Yeni video için AI testi hazır.");

    setAiVideoUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });
    setAiVideoProgress(0);
    setAiVideoMessage("5 saniyelik AI video testi için hazır.");
  }

  function selectVideo(file: File) {
    if (!file.type.startsWith("video/")) {
      setMessage("Lütfen geçerli bir video dosyası seç.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setMessage("Dosya boyutu 1 GB sınırını aşıyor.");
      return;
    }

    const newUrl = URL.createObjectURL(file);
    setVideo(file);
    setPreviewUrl(newUrl);
    setYoutubeEmbed("");
    setDuration(0);
    clearOutputs();
    clearAiResults();
    setProgress(0);
    setMessage("Video yüklendi. Süresi okunuyor...");

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleMetadata() {
    const value = videoRef.current?.duration || 0;

    if (Number.isFinite(value) && value > 0) {
      setDuration(value);
      setMessage("Video hazır. Shorts oluşturabilirsin.");
    } else {
      setMessage("Video süresi okunamadı. Başka bir video deneyebilirsin.");
    }
  }

  async function loadEngine(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (enginePromiseRef.current) return enginePromiseRef.current;

    const promise = (async () => {
      setMessage("Video motoru hazırlanıyor. İlk açılış biraz sürebilir...");

      const ffmpeg = new FFmpeg();

      ffmpeg.on("progress", ({ progress: value }) => {
        if (Number.isFinite(value)) {
          setProgress((old) =>
            Math.max(old, Math.min(99, Math.round(value * 100)))
          );
        }
      });

      const coreURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.js`,
        "text/javascript"
      );

      const wasmURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.wasm`,
        "application/wasm"
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
    setMessage("Sahneler analiz ediliyor...");

    const temporaryUrl = URL.createObjectURL(file);
    const sampleVideo = document.createElement("video");

    sampleVideo.preload = "auto";
    sampleVideo.muted = true;
    sampleVideo.playsInline = true;
    sampleVideo.src = temporaryUrl;

    try {
      await new Promise<void>((resolve, reject) => {
        sampleVideo.onloadedmetadata = () => resolve();
        sampleVideo.onerror = () =>
          reject(new Error("Video analiz için açılamadı."));
      });

      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 54;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Görüntü analiz alanı oluşturulamadı.");

      const samples: { time: number; pixels: Uint8ClampedArray }[] = [];
      const sampleCount = Math.max(2, Math.min(900, Math.floor(length)));

      for (let second = 0; second < sampleCount; second++) {
        const time = Math.min(second, Math.max(0, length - 0.1));
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

        scores.push({
          start: samples[i].time,
          score: difference / (96 * 54),
        });
      }

      return scores;
    } finally {
      sampleVideo.removeAttribute("src");
      sampleVideo.load();
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  async function loadAiSession() {
    if (aiSessionRef.current) return aiSessionRef.current;

    setAiMessage("AI modeli yükleniyor. İlk kullanımda birkaç MB indirilecek...");
    setAiProgress(10);

    try {
      const ort = await import("onnxruntime-web/webgpu");

      try {
        const session = await ort.InferenceSession.create(AI_MODEL_URL, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all",
        });

        aiSessionRef.current = { session, ort };
        aiBackendRef.current = "WebGPU";
        setAiBackend("WebGPU");
        return aiSessionRef.current;
      } catch (gpuError) {
        console.warn("WebGPU başlatılamadı, WASM deneniyor:", gpuError);
      }
    } catch (importError) {
      console.warn("WebGPU modülü yüklenemedi:", importError);
    }

    setAiMessage("WebGPU kullanılamadı. WASM işlemcisi deneniyor...");
    setAiProgress(20);

    const ort = await import("onnxruntime-web");

    const session = await ort.InferenceSession.create(AI_MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    aiSessionRef.current = { session, ort };
    aiBackendRef.current = "WASM";
    setAiBackend("WASM");
    return aiSessionRef.current;
  }

  // Modelin 384x384 girişine kare hazırlar.
  // Görüntü 9:16 merkez kırpılır ve kare içine oranı bozulmadan yerleştirilir.
  function drawPortraitInput(
    source: HTMLVideoElement,
    canvas: HTMLCanvasElement
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("AI giriş görüntüsü oluşturulamadı.");

    const sw = source.videoWidth;
    const sh = source.videoHeight;
    const targetRatio = 9 / 16;

    let cropWidth = sw;
    let cropHeight = sh;

    if (sw / sh > targetRatio) {
      cropWidth = sh * targetRatio;
    } else {
      cropHeight = sw / targetRatio;
    }

    const cropX = (sw - cropWidth) / 2;
    const cropY = (sh - cropHeight) / 2;

    const scaledWidth = 384 * targetRatio;
    const scaledX = (384 - scaledWidth) / 2;

    context.fillStyle = "#000000";
    context.fillRect(0, 0, 384, 384);

    context.drawImage(
      source,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      scaledX,
      0,
      scaledWidth,
      384
    );
  }

  async function runModelOnCanvas(
    inputCanvas: HTMLCanvasElement,
    session: any,
    ort: any
  ): Promise<HTMLCanvasElement> {
    const context = inputCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) throw new Error("AI giriş karesi okunamadı.");

    const imageData = context.getImageData(0, 0, 384, 384).data;
    const planeSize = 384 * 384;
    const inputData = new Float32Array(3 * planeSize);

    for (let i = 0; i < planeSize; i++) {
      const p = i * 4;
      inputData[i] = imageData[p] / 255;
      inputData[planeSize + i] = imageData[p + 1] / 255;
      inputData[2 * planeSize + i] = imageData[p + 2] / 255;
    }

    const tensor = new ort.Tensor("float32", inputData, [1, 3, 384, 384]);
    const result = await session.run({
      [session.inputNames[0]]: tensor,
    });

    const output = result[session.outputNames[0]];
    if (!output?.data) throw new Error("AI modelinden görüntü sonucu alınamadı.");

    const outputSize = 1536;
    const outputPlane = outputSize * outputSize;
    const outputPixels = output.data as Float32Array;
    const rgba = new Uint8ClampedArray(outputPlane * 4);

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

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputSize;
    outputCanvas.height = outputSize;

    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) throw new Error("AI sonucu görüntüye aktarılamadı.");

    outputContext.putImageData(
      new ImageData(rgba, outputSize, outputSize),
      0,
      0
    );

    return outputCanvas;
  }

  async function runAiFrameTest() {
    if (!video || !duration) {
      setAiMessage("Önce bilgisayarından bir video yüklemelisin.");
      return;
    }

    const sourceVideo = videoRef.current;

    if (!sourceVideo || !sourceVideo.videoWidth || !sourceVideo.videoHeight) {
      setAiMessage("Video henüz hazır değil. Birkaç saniye bekleyip tekrar dene.");
      return;
    }

    setAiLoading(true);
    setAiProgress(0);
    setAiBefore("");
    setAiAfter("");
    setAiBackend("");

    try {
      setAiMessage("Videodan örnek kare alınıyor...");
      const sampleTime = Math.min(5, Math.max(0.2, duration / 2));
      await waitForSeek(sourceVideo, sampleTime);

      const inputCanvas = document.createElement("canvas");
      inputCanvas.width = 384;
      inputCanvas.height = 384;

      drawPortraitInput(sourceVideo, inputCanvas);
      setAiBefore(inputCanvas.toDataURL("image/jpeg", 0.9));
      setAiProgress(15);

      const { session, ort } = await loadAiSession();

      setAiMessage("AI modeli çalışıyor...");
      setAiProgress(35);

      const outputCanvas = await runModelOnCanvas(
        inputCanvas,
        session,
        ort
      );

      // Kare içindeki yan boşlukları keserek 9:16 görüntüyü çıkar.
      const portraitCanvas = document.createElement("canvas");
      portraitCanvas.width = 864;
      portraitCanvas.height = 1536;

      const portraitContext = portraitCanvas.getContext("2d");
      if (!portraitContext) throw new Error("AI görüntüsü hazırlanamadı.");

      portraitContext.drawImage(
        outputCanvas,
        336, 0, 864, 1536,
        0, 0, 864, 1536
      );

      setAiAfter(portraitCanvas.toDataURL("image/jpeg", 0.92));
      setAiProgress(100);
      setAiMessage(
        `AI testi başarılı! Görüntü 9:16 oranında hazırlandı. Kullanılan altyapı: ${aiBackendRef.current}.`
      );
    } catch (error) {
      console.error("DEMIVRA AI TEST HATASI:", error);
      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      setAiMessage(`AI testi başarısız: ${detail}`);
      setAiProgress(0);
    } finally {
      setAiLoading(false);
    }
  }

  // 5 saniyelik gerçek AI video işleme testi
  async function createAiVideoTest() {
    if (!video || !duration) {
      setAiVideoMessage("Önce bilgisayarından bir video yüklemelisin.");
      return;
    }

    if (duration < AI_TEST_SECONDS) {
      setAiVideoMessage("AI video testi için video en az 5 saniye olmalı.");
      return;
    }

    const sourceVideo = videoRef.current;
    if (!sourceVideo || !sourceVideo.videoWidth || !sourceVideo.videoHeight) {
      setAiVideoMessage("Video henüz hazır değil. Birkaç saniye bekle.");
      return;
    }

    setAiVideoLoading(true);
    setAiVideoProgress(0);
    setAiVideoMessage("AI video testi hazırlanıyor...");

    const originalTime = sourceVideo.currentTime;
    const wasPaused = sourceVideo.paused;
    const frameFiles: string[] = [];
    const inputName = "demivra_ai_input.mp4";
    const outputName = "demivra_ai_output.mp4";

    try {
      sourceVideo.pause();

      const { session, ort } = await loadAiSession();
      setAiVideoMessage(
        `AI modeli hazır (${aiBackendRef.current}). Video motoru hazırlanıyor...`
      );

      const ffmpeg = await loadEngine();
      await ffmpeg.writeFile(inputName, await fetchFile(video));

      const inputCanvas = document.createElement("canvas");
      inputCanvas.width = 384;
      inputCanvas.height = 384;

      const portraitCanvas = document.createElement("canvas");
      portraitCanvas.width = 864;
      portraitCanvas.height = 1536;

      const portraitContext = portraitCanvas.getContext("2d");
      if (!portraitContext) {
        throw new Error("AI video görüntü alanı oluşturulamadı.");
      }

      const totalFrames = AI_TEST_SECONDS * AI_FPS;

      for (let frame = 0; frame < totalFrames; frame++) {
        const time = frame / AI_FPS;

        setAiVideoMessage(
          `AI kareleri işleniyor: ${frame + 1}/${totalFrames}. Bu işlem bilgisayarının gücüne bağlı olarak zaman alabilir.`
        );

        await waitForSeek(sourceVideo, time);
        drawPortraitInput(sourceVideo, inputCanvas);

        const outputCanvas = await runModelOnCanvas(
          inputCanvas,
          session,
          ort
        );

        portraitContext.clearRect(0, 0, 864, 1536);
        portraitContext.drawImage(
          outputCanvas,
          336, 0, 864, 1536,
          0, 0, 864, 1536
        );

        const frameName = `demivra_ai_frame_${String(frame).padStart(3, "0")}.png`;
        const bytes = await canvasToBytes(portraitCanvas);
        await ffmpeg.writeFile(frameName, bytes);
        frameFiles.push(frameName);

        setAiVideoProgress(
          Math.round(((frame + 1) / totalFrames) * 85)
        );
      }

      setAiVideoMessage("AI kareleri tamamlandı. MP4 video ve ses birleştiriliyor...");

      await ffmpeg.exec([
        "-framerate", String(AI_FPS),
        "-i", "demivra_ai_frame_%03d.png",
        "-i", inputName,
        "-t", String(AI_TEST_SECONDS),
        "-map", "0:v:0",
        "-map", "1:a?",
        "-vf", "fps=30,format=yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        outputName,
      ]);

      const outputData = await ffmpeg.readFile(outputName);
      if (typeof outputData === "string") {
        throw new Error("AI video çıktısı okunamadı.");
      }

      const blob = new Blob([outputData], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setAiVideoUrl((oldUrl) => {
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return url;
      });

      setAiVideoName("demivra-ai-5-saniye.mp4");
      setAiVideoProgress(100);
      setAiVideoMessage(
        `AI video testi tamamlandı! ${AI_TEST_SECONDS} saniyelik video oluşturuldu. Altyapı: ${aiBackendRef.current}.`
      );

      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        // Çıktı dosyası temizliği.
      }
    } catch (error) {
      console.error("DEMIVRA AI VIDEO HATASI:", error);

      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);

      setAiVideoMessage(`AI video işlemi başarısız: ${detail}`);
      setAiVideoProgress(0);
    } finally {
      const ffmpeg = ffmpegRef.current;

      if (ffmpeg) {
        for (const name of frameFiles) {
          try {
            await ffmpeg.deleteFile(name);
          } catch {
            // Dosya daha önce silinmiş olabilir.
          }
        }

        try {
          await ffmpeg.deleteFile(inputName);
        } catch {
          // Dosya bulunmayabilir.
        }

        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          // Dosya bulunmayabilir.
        }
      }

      try {
        await waitForSeek(sourceVideo, Math.min(originalTime, duration - 0.1));
        if (!wasPaused) await sourceVideo.play();
      } catch {
        // Önizleme eski konumuna dönemeyebilir.
      }

      setAiVideoLoading(false);
    }
  }

  async function createShorts() {
    if (!video) {
      setMessage(
        "Shorts oluşturmak için önce video dosyasını yüklemelisin. YouTube önizlemesi tek başına dönüştürülemez."
      );
      return;
    }

    if (!duration || !Number.isFinite(duration)) {
      setMessage("Video süresi henüz okunmadı.");
      return;
    }

    if (duration < 5) {
      setMessage("Video en az 5 saniye uzunluğunda olmalı.");
      return;
    }

    setLoading(true);
    setProgress(0);
    clearOutputs();

    const newUrls: string[] = [];
    let ffmpeg: FFmpeg | null = null;
    let inputName = "";

    try {
      const scenes = await analyzeVideo(video, duration);
      if (!scenes.length) {
        throw new Error("Videoda analiz edilebilir sahne bulunamadı.");
      }

      setProgress(30);
      const selectedScenes = chooseScenes(scenes, duration, clipSeconds);

      setMessage(
        `${selectedScenes.length} farklı bölüm seçildi. Video motoru hazırlanıyor...`
      );

      ffmpeg = await loadEngine();

      const extension = video.name.split(".").pop()?.toLowerCase();
      inputName = `input.${extension || "mp4"}`;
      await ffmpeg.writeFile(inputName, await fetchFile(video));

      const results: ShortVideo[] = [];
      const outputWidth = Math.round((outputHeight * 9) / 16);

      for (let i = 0; i < selectedScenes.length; i++) {
        const scene = selectedScenes[i];
        const outputName = `demivra_${i + 1}.mp4`;
        const clipLength = Math.min(clipSeconds, duration - scene.start);

        const quality =
          outputHeight === 2160
            ? "4K"
            : outputHeight === 1440
              ? "2K"
              : outputHeight === 1920
                ? "1080p"
                : "720p";

        setMessage(
          `${i + 1}/${selectedScenes.length} Shorts hazırlanıyor... (${quality})`
        );

        await ffmpeg.exec([
          "-ss", String(scene.start),
          "-i", inputName,
          "-t", String(clipLength),
          "-map", "0:v:0",
          "-map", "0:a?",
          "-vf",
          `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputWidth}:${outputHeight},setsar=1,unsharp=5:5:0.7:3:3:0.3`,
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outputName,
        ]);

        const data = await ffmpeg.readFile(outputName);
        if (typeof data === "string") {
          throw new Error("Oluşturulan video okunamadı.");
        }

        const blob = new Blob([data], { type: "video/mp4" });
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
      console.error("DEMIVRA GERÇEK HATA:", error);
      newUrls.forEach((url) => URL.revokeObjectURL(url));

      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);

      setMessage(`İşlem başarısız: ${detail}`);
      setProgress(0);
    } finally {
      if (ffmpeg && inputName) {
        try {
          await ffmpeg.deleteFile(inputName);
        } catch {
          // Dosya daha önce silinmiş olabilir.
        }
      }

      setLoading(false);
    }
  }

  async function loadDirectVideoUrl() {
    const address = videoUrl.trim();

    if (!address) {
      setMessage("Önce video bağlantısı gir.");
      return;
    }

    const youtubeUrl = getYouTubeEmbedUrl(address);

    if (youtubeUrl) {
      setYoutubeEmbed(youtubeUrl);
      setVideo(null);
      setPreviewUrl("");
      setDuration(0);
      clearOutputs();
      clearAiResults();

      setMessage(
        "YouTube bağlantısı tanındı. Önizleme yükleniyor. Dönüştürmek için video dosyasına erişmen gerekir."
      );
      return;
    }

    if (/youtube\.com|youtu\.be/i.test(address)) {
      setMessage("YouTube bağlantısı tanınamadı. Geçerli bir video bağlantısı kullan.");
      return;
    }

    try {
      new URL(address);
    } catch {
      setMessage("Geçerli bir internet bağlantısı gir.");
      return;
    }

    setLoading(true);
    setMessage("Doğrudan video bağlantısı kontrol ediliyor...");

    try {
      const response = await fetch(address);
      if (!response.ok) throw new Error("Bağlantıdan video alınamadı.");

      const type = response.headers.get("content-type") || "";
      if (!type.startsWith("video/") && !type.includes("octet-stream")) {
        throw new Error("Bu bağlantı doğrudan video dosyası değil.");
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error("Video dosyası boş.");
      if (blob.size > MAX_FILE_SIZE) {
        throw new Error("Video 1 GB sınırını aşıyor.");
      }

      const extension = type.includes("webm")
        ? "webm"
        : type.includes("quicktime")
          ? "mov"
          : "mp4";

      const file = new File(
        [blob],
        `demivra-video.${extension}`,
        { type: type.startsWith("video/") ? type : "video/mp4" }
      );

      setYoutubeEmbed("");
      selectVideo(file);
      setMessage("Video bağlantıdan başarıyla alındı.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Bilinmeyen hata";

      setMessage(
        `${detail} Kaynak sunucu CORS erişimine izin vermiyor olabilir. Videoyu bilgisayarından yüklemeyi deneyebilirsin.`
      );
    } finally {
      setLoading(false);
    }
  }

  function updateOutput(
    index: number,
    field: "title" | "description",
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
      setMessage("Metin panoya kopyalandı.");
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();

        const copied = document.execCommand("copy");
        textarea.remove();

        if (!copied) throw new Error("Kopyalanamadı.");
        setMessage("Metin panoya kopyalandı.");
      } catch {
        setMessage("Kopyalama başarısız. Metni seçerek kopyalayabilirsin.");
      }
    }
  }

  return (
    <div className="demivra">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #080b14; }
        button, input, select, textarea { font: inherit; }

        .demivra {
          min-height: 100vh;
          padding: 0 20px 45px;
          color: #f4f5ff;
          background: radial-gradient(ellipse at 50% 0%, #20264b 0%, transparent 48%), #080b14;
          font-family: Inter, Arial, sans-serif;
        }

        .topbar {
          max-width: 1120px;
          height: 82px;
          margin: auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #ffffff15;
        }

        .logo { font-size: 25px; font-weight: 900; letter-spacing: 2px; }
        .logo span { color: #9181ff; }

        .pill {
          color: #c1b8ff;
          background: #8171ff18;
          border: 1px solid #8171ff66;
          border-radius: 30px;
          padding: 9px 14px;
          font-size: 11px;
          letter-spacing: 1px;
        }

        .hero { max-width: 820px; margin: 75px auto 40px; text-align: center; }

        .tag {
          display: inline-block;
          padding: 9px 15px;
          color: #b7aaff;
          border: 1px solid #7564ef66;
          border-radius: 30px;
          font-size: 11px;
          letter-spacing: 1.5px;
        }

        .hero h1 {
          font-size: clamp(38px, 7vw, 68px);
          line-height: 1.08;
          letter-spacing: -2px;
          margin: 25px 0 16px;
        }

        .gradient {
          color: #a99cff;
          background: linear-gradient(90deg, #a99cff, #6ddaff);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .description { color: #9ca9c2; line-height: 1.7; font-size: 15px; }

        .panel {
          max-width: 760px;
          margin: 0 auto;
          padding: 30px;
          border: 1px solid #ffffff18;
          border-radius: 22px;
          background: #111827;
          box-shadow: 0 25px 80px #0005;
        }

        .panel h2 { margin: 0 0 8px; font-size: 20px; }
        .muted { color: #8f9bb5; font-size: 13px; line-height: 1.65; }

        .upload {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 11px;
          min-height: 150px;
          margin-top: 24px;
          padding: 20px;
          border: 1px dashed #8172ed;
          border-radius: 15px;
          background: #7768e710;
          text-align: center;
          cursor: pointer;
        }

        .upload strong { font-size: 15px; }
        .upload span { color: #8e9ab4; font-size: 12px; }
        .upload input { display: none; }

        .or {
          margin: 22px 0;
          color: #68738b;
          text-align: center;
          font-size: 11px;
          letter-spacing: 1px;
        }

        .urlrow { display: flex; gap: 10px; }
        .urlrow input {
          min-width: 0;
          flex: 1;
          padding: 14px;
          color: white;
          background: #080d19;
          border: 1px solid #29344d;
          border-radius: 10px;
          outline: none;
        }

        .urlrow input:focus { border-color: #897aff; }

        .demivra button {
          padding: 13px 18px;
          color: white;
          font-weight: 800;
          background: linear-gradient(100deg, #7564ed, #4c8fff);
          border: 0;
          border-radius: 10px;
          cursor: pointer;
        }

        .demivra button:disabled { opacity: .5; cursor: not-allowed; }

        .selected {
          margin-top: 18px;
          padding: 13px;
          color: #a7f3d0;
          background: #0a1720;
          border: 1px solid #235c55;
          border-radius: 10px;
          overflow-wrap: anywhere;
          font-size: 13px;
        }

        .preview {
          display: block;
          width: 100%;
          max-height: 300px;
          margin-top: 18px;
          border-radius: 12px;
          background: #000;
        }

        .youtube-preview {
          display: block;
          width: 100%;
          margin-top: 18px;
          aspect-ratio: 16 / 9;
          border: 0;
          border-radius: 12px;
          background: #000;
        }

        .youtube-note, .ai-note {
          padding: 12px;
          margin-top: 12px;
          color: #c6c1ff;
          background: #7564ed18;
          border: 1px solid #7564ed55;
          border-radius: 10px;
          font-size: 12px;
          line-height: 1.6;
        }

        .mainbutton {
          width: 100%;
          margin-top: 22px;
          padding: 17px !important;
          font-size: 14px;
          letter-spacing: .5px;
        }

        .progress, .ai-progress {
          height: 8px;
          margin-top: 20px;
          overflow: hidden;
          border-radius: 10px;
          background: #273149;
        }

        .progress div, .ai-progress div {
          height: 100%;
          background: linear-gradient(90deg, #8977ff, #59d9ff);
          transition: width .25s;
        }

        .message {
          margin-top: 16px;
          color: #b6c2d9;
          font-size: 13px;
          line-height: 1.7;
          overflow-wrap: anywhere;
        }

        .ai-panel {
          max-width: 900px;
          margin: 35px auto 0;
          padding: 25px;
          border: 1px solid #7564ed66;
          border-radius: 18px;
          background: linear-gradient(140deg, #171b35, #101827);
        }

        .ai-panel h2 { margin: 0 0 8px; font-size: 20px; }
        .ai-button { width: 100%; margin-top: 16px; padding: 16px !important; }
        .ai-progress { margin-top: 15px; }
        .ai-status { margin-top: 13px; color: #c6c1ff; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
        .ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; margin-top: 20px; }
        .ai-image-card { min-width: 0; padding: 12px; background: #080d19; border: 1px solid #ffffff18; border-radius: 12px; }
        .ai-image-card strong { display: block; margin-bottom: 10px; font-size: 13px; }
        .ai-image-card img { display: block; width: 100%; height: auto; border-radius: 8px; background: #000; }
        .ai-backend { display: inline-block; margin-top: 10px; color: #9cebd3; font-size: 12px; }

        .ai-video-result {
          margin-top: 20px;
          padding: 15px;
          border: 1px solid #3e8c79;
          border-radius: 12px;
          background: #0b1b20;
        }

        .ai-video-result video {
          display: block;
          width: 100%;
          max-height: 560px;
          margin-top: 12px;
          background: #000;
          border-radius: 10px;
        }

        .ai-download {
          display: block;
          margin-top: 12px;
          padding: 13px;
          color: white;
          background: #18765e;
          border-radius: 9px;
          text-align: center;
          text-decoration: none;
          font-size: 13px;
          font-weight: 800;
        }

        .results { max-width: 1100px; margin: 50px auto; }
        .results h2 { font-size: 24px; }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 18px;
          margin-top: 22px;
          align-items: start;
        }

        .clip {
          min-width: 0;
          padding: 14px;
          overflow: hidden;
          border: 1px solid #ffffff18;
          border-radius: 16px;
          background: #111827;
        }

        .clip video {
          display: block;
          width: 100%;
          aspect-ratio: 9 / 16;
          object-fit: contain;
          background: #000;
          border-radius: 10px;
        }

        .clip h3 { font-size: 14px; }
        .clip p { color: #96a3bd; font-size: 12px; line-height: 1.7; }

        .metadata-label {
          display: block;
          margin: 18px 0 7px;
          color: #b9c4dc;
          font-size: 12px;
          font-weight: 800;
        }

        .metadata-input, .metadata-textarea {
          display: block;
          width: 100%;
          padding: 11px;
          color: #f4f5ff;
          background: #080d19;
          border: 1px solid #303c57;
          border-radius: 9px;
          outline: none;
          font-size: 13px;
          line-height: 1.6;
        }

        .metadata-input:focus, .metadata-textarea:focus { border-color: #897aff; }
        .metadata-textarea { min-height: 125px; resize: vertical; }
        .copy-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 9px; }
        .copy-row button { padding: 10px 7px; font-size: 11px; }

        .copy-all {
          width: 100%;
          margin-top: 9px;
          padding: 11px !important;
          background: #273653 !important;
          border: 1px solid #53658a !important;
          font-size: 12px;
        }

        .download {
          display: block;
          margin-top: 14px;
          padding: 12px;
          color: white;
          background: #6254d9;
          border-radius: 9px;
          text-align: center;
          text-decoration: none;
          font-size: 13px;
          font-weight: 800;
        }

        .footer { padding-top: 45px; color: #64708a; text-align: center; font-size: 12px; }

        @media(max-width: 600px) {
          .demivra { padding: 0 13px 30px; }
          .hero { margin-top: 55px; }
          .panel, .ai-panel { padding: 20px; }
          .urlrow { flex-direction: column; }
          .topbar { height: 70px; }
          .logo { font-size: 21px; }
          .grid { grid-template-columns: 1fr; }
          .ai-grid { grid-template-columns: 1fr; }
        }
      `}</style>

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
          <label style={{ display: "block", marginBottom: 10 }}>
            Shorts video süresi
          </label>
          <select
            value={clipSeconds}
            onChange={(event) => setClipSeconds(Number(event.target.value))}
            disabled={loading || aiVideoLoading}
            style={{
              width: "100%",
              padding: 14,
              color: "white",
              background: "#080d19",
              border: "1px solid #7564ed",
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
          <label style={{ display: "block", marginBottom: 10 }}>
            Çıktı video kalitesi
          </label>
          <select
            value={outputHeight}
            onChange={(event) => setOutputHeight(Number(event.target.value))}
            disabled={loading || aiVideoLoading}
            style={{
              width: "100%",
              padding: 14,
              color: "white",
              background: "#080d19",
              border: "1px solid #7564ed",
              borderRadius: 10,
            }}
          >
            <option value={1280}>720p HD</option>
            <option value={1920}>1080p Full HD</option>
            <option value={2560}>1440p 2K</option>
            <option value={3840}>2160p 4K</option>
          </select>
          <p className="muted">
            Normal dönüştürme seçilen çözünürlüğe ölçeklendirilir ve
            keskinleştirme uygulanır. 4K işlem daha fazla bellek ve işlem gücü
            gerektirir.
          </p>
        </div>

        <p className="muted">
          Bilgisayarından video seç veya doğrudan video dosyası bağlantısı gir.
          YouTube bağlantısını da önizleyebilirsin.
        </p>

        <label className="upload">
          <strong>＋ Bilgisayarından video seç</strong>
          <span>MP4, MOV, WEBM ve tarayıcının desteklediği video formatları</span>
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
            disabled={loading || aiVideoLoading}
          />
          <button onClick={loadDirectVideoUrl} disabled={loading || aiVideoLoading}>
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
              Video önizlemesi YouTube oynatıcısı üzerinden gösterilir.
              Shorts oluşturmak için video dosyasını yüklemelisin.
            </div>
          </>
        )}

        {video && (
          <div className="selected">
            <strong>✓ Video seçildi:</strong> {video.name}
            <br />
            Süre: {duration > 0 ? formatTime(duration) : "Okunuyor..."}
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
          disabled={!video || !duration || loading || aiVideoLoading}
        >
          {loading ? "İŞLEM DEVAM EDİYOR..." : "✦ SHORTS OLUŞTUR"}
        </button>

        {loading && (
          <div className="progress">
            <div style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="message">{message}</div>

        <p className="muted">
          {engineReady
            ? "✓ Video motoru hazır. Dönüştürmeye başlayabilirsin."
            : "Video dönüştürmek için bir video yükle ve SHORTS OLUŞTUR düğmesine bas. Motor otomatik hazırlanacaktır."}
        </p>
      </main>

      <section className="ai-panel">
        <h2>✦ Demivra AI Görüntü İyileştirme</h2>
        <p className="muted">
          Real-ESRGAN modeliyle önce tek kareyi test edebilir, ardından 5 saniyelik
          kısa bir videoyu AI ile işleyebilirsin.
        </p>

        <div className="ai-note">
          AI modeli ilk kullanımda internetten indirilir. WebGPU desteklenirse
          ekran kartı, desteklenmezse WASM işlemcisi kullanılmaya çalışılır.
          AI video testi 5 saniyeyle sınırlıdır ve bilgisayarının gücüne göre
          uzun sürebilir.
        </div>

        <button
          className="ai-button"
          onClick={runAiFrameTest}
          disabled={!video || !duration || aiLoading || loading || aiVideoLoading}
        >
          {aiLoading ? "AI TESTİ ÇALIŞIYOR..." : "✦ TEK KAREDE AI TESTİNİ BAŞLAT"}
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
                <strong>AI sonucu · 864 × 1536 · Dikey</strong>
                <img src={aiAfter} alt="AI ile iyileştirilmiş video karesi" />
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 30, paddingTop: 22, borderTop: "1px solid #ffffff20" }}>
          <h2>✦ AI ile 5 Saniyelik Video Oluştur</h2>
          <p className="muted">
            Seçtiğin videonun ilk 5 saniyesi işlenir. Her örnek kare AI modelinden
            geçirilir, dikey görüntü hazırlanır ve orijinal ses MP4 çıktısına
            eklenir. Bu ilk performans testidir.
          </p>

          <button
            className="ai-button"
            onClick={createAiVideoTest}
            disabled={
              !video ||
              !duration ||
              duration < AI_TEST_SECONDS ||
              aiVideoLoading ||
              aiLoading ||
              loading
            }
          >
            {aiVideoLoading
              ? "AI VİDEO İŞLENİYOR..."
              : "✦ 5 SANİYELİK AI VİDEO TESTİNİ BAŞLAT"}
          </button>

          {aiVideoLoading && (
            <div className="ai-progress">
              <div style={{ width: `${aiVideoProgress}%` }} />
            </div>
          )}

          <div className="ai-status">{aiVideoMessage}</div>

          {aiVideoUrl && (
            <div className="ai-video-result">
              <strong>✓ AI video hazır</strong>
              <video src={aiVideoUrl} controls playsInline />
              <a className="ai-download" href={aiVideoUrl} download={aiVideoName}>
                ↓ AI İLE İYİLEŞTİRİLMİŞ MP4 İNDİR
              </a>
            </div>
          )}
        </div>
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
                  Çözünürlük:{" "}
                  {outputHeight === 2160 ? "2160p 4K" : `${outputHeight}p`}
                </p>

                <label className="metadata-label">YouTube başlığı</label>
                <input
                  className="metadata-input"
                  value={item.title}
                  maxLength={100}
                  onChange={(event) =>
                    updateOutput(index, "title", event.target.value)
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
                        "title",
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
                    updateOutput(index, "description", event.target.value)
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

export default App;
