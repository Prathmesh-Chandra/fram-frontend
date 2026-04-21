import { useEffect, useState } from "react"
import { fetchUniverse } from "@/api/client"
import usePortfolioStore from "@/store/usePortfolioStore"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const formatTurnover = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A"
  return `${value.toFixed(2)} Cr`
}

function FieldLabel({ children, tag }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
        {children}
      </label>
      {tag && (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/50 tracking-wider uppercase">
          {tag}
        </span>
      )}
    </div>
  )
}

export default function StockSelector({ onAnalyze }) {
  const [universe, setUniverse] = useState({ liquid: [], illiquid: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const { selectedStocks, setStockPair } = usePortfolioStore()

  useEffect(() => {
    let alive = true
    fetchUniverse()
      .then((data) => {
        if (!alive) return
        if (Array.isArray(data?.liquid) && Array.isArray(data?.illiquid)) {
          setUniverse({ liquid: data.liquid, illiquid: data.illiquid })
        } else {
          setError("Unable to load stock universe")
        }
      })
      .catch(() => {
        if (!alive) return
        setError("Failed to fetch stocks")
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  const liquidSelection   = selectedStocks.find(t => universe.liquid.some(s => s.ticker === t))
  const illiquidSelection = selectedStocks.find(t => universe.illiquid.some(s => s.ticker === t))

  const handleLiquidChange = (val) => {
    setStockPair(val, illiquidSelection || null)
  }

  const handleIlliquidChange = (val) => {
    setStockPair(liquidSelection || null, val)
  }

  const ready = !!(liquidSelection && illiquidSelection)

  return (
    <div className="flex flex-col gap-5">

      {/* Liquid */}
      <div>
        <FieldLabel tag="TOP 25%">Liquid Asset</FieldLabel>
        <Select value={liquidSelection || ""} onValueChange={handleLiquidChange}>
          <SelectTrigger
            className={`
              w-full h-9 text-xs font-mono rounded
              bg-[#0c0c0e] border transition-colors
              ${liquidSelection
                ? "border-[#e8f44a]/30 text-foreground"
                : "border-border/40 text-muted-foreground"
              }
              focus:ring-1 focus:ring-[#e8f44a]/30 focus:border-[#e8f44a]/40
              hover:border-border/70
            `}
          >
            <SelectValue placeholder={loading ? "Loading…" : "Select instrument"} />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="z-50 bg-[#141416] border border-border/60 shadow-2xl rounded overflow-hidden font-mono text-xs"
          >
            {universe.liquid.map((s) => (
              <SelectItem
                key={s.ticker}
                value={s.ticker}
                className="py-2 cursor-pointer text-xs focus:bg-[#e8f44a]/8 focus:text-foreground"
              >
                <div className="flex items-center justify-between gap-4 w-full">
                  <span className="font-semibold tracking-wide">{s.ticker}</span>
                  <span className="text-muted-foreground/60 text-[10px]">{formatTurnover(s.avg_turnover_cr)}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {liquidSelection && (
          <p className="mt-1.5 text-[10px] font-mono text-emerald-500/70 tracking-wide">
            ✓ {liquidSelection} selected
          </p>
        )}
      </div>

      {/* Illiquid */}
      <div>
        <FieldLabel tag="BTM 25%">Illiquid Asset</FieldLabel>
        <Select value={illiquidSelection || ""} onValueChange={handleIlliquidChange}>
          <SelectTrigger
            className={`
              w-full h-9 text-xs font-mono rounded
              bg-[#0c0c0e] border transition-colors
              ${illiquidSelection
                ? "border-[#e8f44a]/30 text-foreground"
                : "border-border/40 text-muted-foreground"
              }
              focus:ring-1 focus:ring-[#e8f44a]/30 focus:border-[#e8f44a]/40
              hover:border-border/70
            `}
          >
            <SelectValue placeholder={loading ? "Loading…" : "Select instrument"} />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="z-50 bg-[#141416] border border-border/60 shadow-2xl rounded overflow-hidden font-mono text-xs"
          >
            {universe.illiquid.map((s) => (
              <SelectItem
                key={s.ticker}
                value={s.ticker}
                className="py-2 cursor-pointer text-xs focus:bg-[#e8f44a]/8 focus:text-foreground"
              >
                <div className="flex items-center justify-between gap-4 w-full">
                  <span className="font-semibold tracking-wide">{s.ticker}</span>
                  <span className="text-muted-foreground/60 text-[10px]">{formatTurnover(s.avg_turnover_cr)}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {illiquidSelection && (
          <p className="mt-1.5 text-[10px] font-mono text-emerald-500/70 tracking-wide">
            ✓ {illiquidSelection} selected
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border/20" />

      {/* Action */}
      <Button
        onClick={onAnalyze}
        disabled={!ready}
        className={`
          w-full h-9 text-[11px] font-bold tracking-widest uppercase rounded
          transition-all duration-200
          ${ready
            ? "bg-[#e8f44a] text-black hover:bg-[#d4e03b] shadow-[0_0_20px_rgba(232,244,74,0.15)] hover:shadow-[0_0_28px_rgba(232,244,74,0.25)]"
            : "bg-white/5 text-muted-foreground/30 cursor-not-allowed"
          }
        `}
      >
        {ready ? "Initialize Engine →" : "Select Both Instruments"}
      </Button>

      {error && (
        <p className="text-[10px] font-mono text-red-400/70 animate-in fade-in">{error}</p>
      )}
    </div>
  )
}