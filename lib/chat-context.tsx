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

// Hook: pages call this to register their current state with the chat.
// Auto-cleared on unmount or when deps change.
export function useRegisterChatContext(label: string, data: unknown) {
  const ctx = useChatContext();
  const ref = useRef(0);
  useEffect(() => {
    ctx.setContext(label, data);
    return () => {
      // Only clear if no one else has set context after us
      const id = ++ref.current;
      queueMicrotask(() => {
        if (id === ref.current) ctx.clearContext();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, JSON.stringify(data)]);
}
