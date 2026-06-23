"use client";

import { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    };
  }
}

export function usePiP() {
  const [pipSupported, setPipSupported] = useState<boolean | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const pipWinRef = useRef<Window | null>(null);

  useEffect(() => {
    setPipSupported("documentPictureInPicture" in window);
  }, []);

  async function openPiP(width = 400, height = 400) {
    if (!window.documentPictureInPicture) return;
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({ width, height });
      pipWinRef.current = pipWin;

      // Copy Tailwind/CSS to PiP window
      [...document.head.querySelectorAll('link[rel="stylesheet"], style')].forEach((el) => {
        pipWin.document.head.appendChild(el.cloneNode(true));
      });

      pipWin.document.documentElement.style.height = "100%";
      Object.assign(pipWin.document.body.style, {
        margin: "0",
        padding: "0",
        height: "100%",
        background: "#18181b",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      });

      const container = pipWin.document.createElement("div");
      container.style.cssText = "height: 100%;";
      pipWin.document.body.appendChild(container);
      setPipContainer(container);

      pipWin.addEventListener("pagehide", () => {
        setPipContainer(null);
        pipWinRef.current = null;
      });
    } catch (e) {
      console.error("PiP failed:", e);
    }
  }

  function closePiP() {
    pipWinRef.current?.close();
    setPipContainer(null);
    pipWinRef.current = null;
  }

  return { pipSupported, pipContainer, openPiP, closePiP };
}
