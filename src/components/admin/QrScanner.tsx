"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Reads booking QR codes with the phone camera. Works on Android and iPhone browsers
 * (the page must be served over https, which Vercel does).
 */
export default function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play();
        const tick = () => {
          if (stopped) return;
          const c = canvas.current!;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            const match = found?.data.match(/LPP-[A-Z0-9]{5}/);
            if (match) {
              setOn(false);
              onCode(match[0]);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Camera not available. Allow camera access, or type the reference code instead.");
        setOn(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, onCode]);

  return (
    <div>
      {on ? (
        <div className="overflow-hidden rounded-2xl bg-ink">
          <video ref={video} className="aspect-square w-full object-cover" muted />
          <button type="button" onClick={() => setOn(false)} className="w-full bg-ink py-3 font-bold text-white">Stop camera</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setError(null); setOn(true); }}
          className="w-full rounded-2xl bg-court py-6 font-display text-xl font-semibold text-white">
          Scan booking QR
        </button>
      )}
      <canvas ref={canvas} className="hidden" />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
