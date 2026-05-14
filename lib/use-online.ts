"use client";
import { useEffect, useState } from "react";

// Tracks navigator.onLine. Browsers fire 'online' / 'offline' events when the
// machine's network connectivity changes — this gives us a reactive boolean
// the OfflineBanner can subscribe to. Initial value defaults to true on the
// server (no `navigator`); the effect corrects it on mount.
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    function up() {
      setOnline(true);
    }
    function down() {
      setOnline(false);
    }
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
