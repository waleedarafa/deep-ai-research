"use client";

import { create } from "zustand";

interface FilterState {
  topic: string | null;
  setTopic: (t: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  topic: null,
  setTopic: (t) => set({ topic: t }),
}));
