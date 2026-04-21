import { create } from "zustand"
import { v4 as uuidv4 } from "uuid"

const usePortfolioStore = create((set) => ({
  // Core Portfolio State
  selectedStocks: [],
  positions: [],
  marketData: {},
  
  // Analytics Cache State
  partAData: null,
  partBData: null,
  partCData: null,
  isAnalyzing: false,
  isPricing: false,
  isHedging: false,

  // --- Actions ---

  addStock: (ticker) =>
    set((state) => {
      if (state.selectedStocks.includes(ticker)) return state
      if (state.selectedStocks.length >= 2) return state
      // Reset analytics data when stock selection changes so stale data isn't shown
      return { selectedStocks: [...state.selectedStocks, ticker], partAData: null, partBData: null, partCData: null }
    }),

  removeStock: (ticker) =>
    set((state) => ({
      selectedStocks: state.selectedStocks.filter((t) => t !== ticker),
      positions: state.positions.filter((p) => p.ticker !== ticker),
      // Reset analytics data if the selection breaks (no longer exactly 2 stocks)
      partAData: null,
      partBData: null,
      partCData: null 
    })),

  setStockPair: (liquidTicker, illiquidTicker) =>
    set(() => ({
      selectedStocks: [liquidTicker, illiquidTicker].filter(Boolean),
      partAData: null,
      partBData: null,
      partCData: null,
    })),

  addPosition: (position) =>
    set((state) => ({
      positions: [...state.positions, { ...position, id: uuidv4() }],
    })),

  removePosition: (id) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.id !== id),
    })),

  updatePosition: (id, updates) =>
    set((state) => ({
      positions: state.positions.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  setMarketData: (ticker, data) =>
    set((state) => ({
      marketData: { ...state.marketData, [ticker]: data },
    })),

  // --- Analytics Actions ---
  
  setPartAData: (data) => set({ partAData: data }),

  setPartBData: (data) => set({ partBData: data }),

  setPartCData: (data) => set({ partCData: data }),
  
  setIsAnalyzing: (status) => set({ isAnalyzing: status }),

  setIsPricing: (status) => set({ isPricing: status }),

  setIsHedging: (status) => set({ isHedging: status }),
  
  clearAll: () => set({ 
    selectedStocks: [], 
    positions: [], 
    marketData: {}, 
    partAData: null,
    partBData: null,
    partCData: null,
    isAnalyzing: false,
    isPricing: false,
    isHedging: false
  }),
}))

export default usePortfolioStore