"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export interface ChatContextValue {
  setContext: (label: string, data: unknown) => void;
  clearContext: () => void;
  current: { label: string; data: unknown } | null;
}

const Ctx = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ label: string; data: unknown } | null>(null);

  const value: ChatContextValue = {
    setContext: (label, data) => setCurrent({ label, data }),
    clearContext: () => setCurrent(null),
    current,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatContext() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChatContext must be inside ChatContextProvider");
  return v;
}

// Hook: pages call this to register their current state with the chat. Pass a
// stable `data` reference (memoize at the call site) — this hook does not deep-
// compare. Auto-cleared on unmount.
export function useRegisterChatContext(label: string, data: unknown) {
  const ctx = useChatContext();
  const counter = useRef(0);
  useEffect(() => {
    ctx.setContext(label, data);
    const myId = ++counter.current;
    const counterRef = counter;
    return () => {
      queueMicrotask(() => {
        if (myId === counterRef.current) ctx.clearContext();
      });
    };
    // ctx is stable from Provider (no useMemo needed since Provider state only
    // changes via setContext/clearContext — re-running the effect when ctx
    // changes would be a real signal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, data]);
}
