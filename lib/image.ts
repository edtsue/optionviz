// Client-side image downscale: resizes large screenshots before sending to API.
// Targets 1600px on the longest side and JPEG quality 0.85 — keeps OCR clarity
// while staying well under Vercel's 4.5MB body limit and Anthropic's 5MB image cap.

export interface ResizedImage {
  blob: Blob;
  dataUrl: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  originalBytes: number;
  resizedBytes: number;
}

const MAX_DIMENSION = 1600;
const QUALITY = 0.85;

export async function resizeImage(file: File): Promise<ResizedImage> {
  const originalBytes = file.size;

  const bitmap = await loadBitmap(file);
  const { width, height } = bitmap;

  let targetW = width;
  let targetH = height;
  if (Math.max(width, height) > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(targetW, targetH)
      : (() => {
          const c = document.createElement("canvas");
          c.width = targetW;
          c.height = targetH;
          return c;
        })();

  const ctx = (canvas as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);

  const blob = await canvasToBlob(canvas, "image/jpeg", QUALITY);
  const dataUrl = await blobToDataURL(blob);

  return {
    blob,
    dataUrl,
    mediaType: "image/jpeg",
    width: targetW,
    height: targetH,
    originalBytes,
    resizedBytes: blob.size,
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to HTMLImageElement path
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      type,
      quality,
    );
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
