"use client";

import { createContext, useContext } from "react";

export type Features = {
  processManagement: boolean;
};

const FeaturesContext = createContext<Features | null>(null);

export function FeaturesProvider({
  value,
  children,
}: {
  value: Features;
  children: React.ReactNode;
}) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): Features {
  const ctx = useContext(FeaturesContext);
  if (!ctx) throw new Error("useFeatures must be used inside <FeaturesProvider>");
  return ctx;
}
