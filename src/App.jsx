import { Component, useEffect, useState } from "react"
import StockSelector from "@/components/StockSelector"
import { ensureUpstoxLoginOnStartup, redirectToUpstoxLogin, fetchPartA, fetchPartB, fetchMarketIndices } from "@/api/client"
import PartA from "@/components/PartA"
import PartB from "@/components/PartB"
import PartC from "@/components/PartC"
import PartD from "@/components/PartD"
import usePortfolioStore from "@/store/usePortfolioStore"

const NAV_ITEMS = [
  { id: "part-a", code: "MKT", label: "Market Dynamics",     shortLabel: "A" },
  { id: "part-b", code: "DRV", label: "Derivatives Pricing", shortLabel: "B" },
  { id: "part-c", code: "PRT", label: "Portfolio & Hedging", shortLabel: "C" },
  { id: "part-d", code: "RSK", label: "Risk Measurement",    shortLabel: "D" },
]

const DEFAULT_MARKET_INDICES = [
  { sym: "NIFTY50", val: "--", chg: "--" },
  { sym: "BANKNIFTY", val: "--", chg: "--" },
  { sym: "INDIAVIX", val: "--", chg: "--" },
]

const formatIndexValue = (symbol, value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--"
  const digits = symbol === "INDIAVIX" ? 2 : 2
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const formatIndexChange = (changePct) => {
  if (typeof changePct !== "number" || !Number.isFinite(changePct)) return "--"
  const sign = changePct >= 0 ? "+" : ""
  return `${sign}${changePct.toFixed(2)}%`
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="font-mono tabular-nums text-xs text-muted-foreground tracking-wider">
      {time.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })} IST
    </span>
  )
}

function StatusPill({ label, value, pulse }) {
  return (
    <div className="flex items-center gap-2 border border-border/40 rounded px-3 py-1.5 bg-card">
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
      )}
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono font-semibold text-foreground">{value}</span>
    </div>
  )
}

function EmptyModuleState({ code, label, desc }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-80 gap-4 select-none">
      <div className="text-5xl font-black font-mono tracking-tighter opacity-10" style={{ color: "#e8f44a" }}>
        {code}
      </div>
      <div className="text-center space-y-2 max-w-sm">
        <p className="text-sm font-semibold text-foreground/60">{label}</p>
        <p className="text-xs text-muted-foreground/40 leading-relaxed">{desc}</p>
      </div>
      <div className="mt-4 px-4 py-2 rounded border border-border/30 text-[10px] font-mono text-muted-foreground/30 tracking-wider uppercase">
        Select instruments &amp; initialize engine
      </div>
    </div>
  )
}

class ModuleErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || "Unknown render error" }
  }

  componentDidCatch(error, errorInfo) {
    console.error("Part B runtime render error", error, errorInfo)
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: "" })
    }
  }

  render() {
    if (this.state.hasError) {
      const details = (
        <p className="text-[10px] font-mono text-red-400/80 max-w-xl wrap-break-word px-4 text-center">
          Runtime detail: {this.state.errorMessage}
        </p>
      )

      if (this.props.fallback) {
        return (
          <div className="space-y-3">
            {this.props.fallback}
            {details}
          </div>
        )
      }

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-80 gap-3 text-center">
          <p className="text-sm font-semibold text-foreground/70">Part B failed to render</p>
          <p className="text-xs text-muted-foreground/50 max-w-sm">
            The backend data loaded, but a runtime error occurred while drawing Derivatives Pricing.
          </p>
          {details}
        </div>
      )
    }

    return this.props.children
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("part-a")
  const [authChecking, setAuthChecking] = useState(true)
  const [marketIndices, setMarketIndices] = useState(DEFAULT_MARKET_INDICES)
  const {
    selectedStocks,
    partAData, setPartAData, isAnalyzing, setIsAnalyzing,
    partBData, setPartBData, isPricing, setIsPricing
  } = usePortfolioStore()

  const [upstoxStatus, setUpstoxStatus] = useState({
    authenticated: false,
    user_name: "",
    expires_in_hours: null,
  })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const status = await ensureUpstoxLoginOnStartup()
      if (!alive) return
      if (!status?.authenticated) {
        // Allow guest fallback mode so Part A can still run even if Upstox auth is down.
        setUpstoxStatus({
          authenticated: false,
          user_name: "Guest",
          expires_in_hours: null,
        })
        setAuthChecking(false)
        return
      }
      setUpstoxStatus({
        authenticated: true,
        user_name: status.user_name || "Trader",
        expires_in_hours: status.expires_in_hours ?? null,
      })
      setAuthChecking(false)
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true

    const pullIndices = async () => {
      try {
        const payload = await fetchMarketIndices()
        if (!alive) return

        const rows = Array.isArray(payload?.data?.indices) ? payload.data.indices : []
        if (!rows.length) return

        setMarketIndices(
          rows.map((row) => ({
            sym: row?.symbol || "--",
            val: formatIndexValue(row?.symbol, row?.value),
            chg: formatIndexChange(row?.change_pct),
          }))
        )
      } catch {
        // Keep previously shown values when the live pull fails.
      }
    }

    pullIndices()
    const timer = setInterval(pullIndices, 60000)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const fetchPartAIfNeeded = async () => {
    if (selectedStocks.length !== 2 || partAData || isAnalyzing) return
    setIsAnalyzing(true)
    try {
      const data = await fetchPartA(selectedStocks[0], selectedStocks[1])
      setPartAData(data)
    } catch (err) {
      console.error("Failed to fetch Part A", err)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const fetchPartBIfNeeded = async () => {
    if (selectedStocks.length !== 2 || partBData || isPricing) return
    setIsPricing(true)
    try {
      const data = await fetchPartB(selectedStocks[0], selectedStocks[1])
      setPartBData(data)
    } catch (err) {
      console.error("Failed to fetch Part B", err)
    } finally {
      setIsPricing(false)
    }
  }

  const handleAnalyze = async () => {
    setActiveTab("part-a")
    await fetchPartAIfNeeded()
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] text-foreground grid place-items-center font-mono">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground tracking-widest uppercase animate-pulse">
            Establishing secure connection
          </p>
        </div>
      </div>
    )
  }

  const activeNav = NAV_ITEMS.find(n => n.id === activeTab)

  return (
    /* ROOT: exact viewport, no overflow — children control their own scroll */
    <div
      className="min-h-screen md:h-screen flex flex-col overflow-x-hidden md:overflow-hidden"
      style={{ background: "#0c0c0e", fontFamily: "'IBM Plex Sans', 'Helvetica Neue', sans-serif" }}
    >
      {/* ── TOP CHROME BAR ── never scrolls */}
      <header
        className="flex items-center justify-between px-3 sm:px-4 md:px-6 shrink-0 border-b border-border/50"
        style={{ height: 44, background: "#111114" }}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className="w-5 h-5 rounded-sm grid place-items-center text-[10px] font-black text-black shrink-0"
            style={{ background: "linear-gradient(135deg,#e8f44a,#c5d63a)" }}
          >
            F
          </span>
          <span className="text-xs font-bold tracking-widest uppercase text-foreground">FRAM</span>
          <span className="text-[10px] text-muted-foreground tracking-widest">/</span>
          <span className="hidden sm:inline text-[10px] text-muted-foreground tracking-wider uppercase">Risk Terminal</span>
        </div>

        <div className="hidden md:flex items-center gap-6 text-[10px] font-mono">
          {marketIndices.map(({ sym, val, chg }) => {
            const up = chg.startsWith("+")
            return (
              <div key={sym} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{sym}</span>
                <span className="tabular-nums">{val}</span>
                <span className={up ? "text-emerald-400" : "text-red-400"}>{chg}</span>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Clock />
          <div className="hidden sm:block">
            <StatusPill label="session" value={upstoxStatus.user_name} pulse={upstoxStatus.authenticated} />
          </div>
          <div className="hidden md:block">
            <StatusPill
              label="ttl"
              value={upstoxStatus.authenticated ? `${upstoxStatus.expires_in_hours}h` : "offline"}
            />
          </div>
        </div>
      </header>

      {/* ── MODULE TAB BAR ── never scrolls */}
      <nav
        className="flex items-stretch border-b border-border/40 shrink-0 overflow-x-auto"
        style={{ height: 38, background: "#111114" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={async () => {
                setActiveTab(item.id)

                if (item.id === "part-a") {
                  await fetchPartAIfNeeded()
                }

                if (item.id === "part-b") {
                  await fetchPartBIfNeeded()
                }
              }}
              className={`
                relative flex items-center gap-2 px-3 sm:px-4 md:px-5 text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase shrink-0 whitespace-nowrap
                transition-colors duration-150 border-r border-border/30
                ${active
                  ? "text-foreground bg-[#0c0c0e]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/3"
                }
              `}
            >
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${active ? "bg-[#e8f44a]/10 text-[#e8f44a]" : "bg-white/5 text-muted-foreground"}`}>
                {item.code}
              </span>
              <span className="hidden sm:inline">{item.label}</span>
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: "#e8f44a" }} />
              )}
            </button>
          )
        })}
            <div className="ml-auto hidden sm:flex items-center px-4 md:px-5 shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground/40 tracking-widest">v2.1.0</span>
        </div>
      </nav>

      {/* ── BODY: fills all remaining height. min-h-0 is critical for flex children to shrink */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">

        {/* ── LEFT SIDEBAR: fixed height, overflow-hidden — NEVER scrolls */}
        <aside
          className="w-full md:w-64 shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-border/40 md:overflow-hidden"
          style={{ background: "#111114" }}
        >
          <div className="px-4 pt-5 pb-3 border-b border-border/30 shrink-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
              Instrument Config
            </p>
          </div>

          <div className="p-4 flex-1 min-h-0 flex flex-col md:justify-between gap-4 md:gap-0">
            <StockSelector onAnalyze={handleAnalyze} />

            <div className="hidden md:block space-y-2 pt-4 border-t border-border/20">
              {[
                { k: "Data Feed",  v: "UPSTOX LIVE", color: "text-emerald-400" },
                { k: "Exchange",   v: "NSE · BSE",   color: "text-foreground/70" },
                { k: "Settlement", v: "T+1",         color: "text-foreground/70" },
              ].map(({ k, v, color }) => (
                <div key={k} className="flex justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground/50">{k}</span>
                  <span className={`font-semibold ${color}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── MAIN WORKSPACE: flex column, min-h-0 so inner div can scroll */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* Sub-header breadcrumb — fixed, never scrolls */}
          <div
            className="flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 border-b border-border/30 shrink-0"
            style={{ background: "#0e0e10" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground/40">MODULE</span>
              <span className="text-[10px] font-mono text-muted-foreground/40">/</span>
              <span className="text-[10px] font-mono font-bold tracking-widest uppercase" style={{ color: "#e8f44a" }}>
                {activeNav?.code}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/40">/</span>
              <span className="text-[10px] font-mono text-muted-foreground">{activeNav?.label}</span>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-muted-foreground/50">LIVE</span>
            </div>
          </div>

          {/* ── THE ONLY SCROLLABLE REGION in the entire app ── */}
          <div
            key={activeTab}
            className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-8 md:pb-10"
            style={{ background: "#0c0c0e" }}
          >
            {activeTab === "part-a" && (
              isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground animate-pulse">
                  <div className="w-5 h-5 border-2 border-[#e8f44a]/30 border-t-[#e8f44a] rounded-full animate-spin" />
                  <span className="text-xs font-mono tracking-widest uppercase">Fetching Analytics & Running Volatility-Liquidity Models...</span>
                </div>
              ) : partAData ? (
                <PartA />
              ) : (
                <EmptyModuleState code="MKT" label="Market Dynamics" desc="Historical volatility, liquidity metrics, return diagnostics, and cross-metric correlation for selected instruments." />
              )
            )}
            {activeTab === "part-b" && (
              isPricing ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground animate-pulse">
                  <div className="w-5 h-5 border-2 border-[#e8f44a]/30 border-t-[#e8f44a] rounded-full animate-spin" />
                  <span className="text-xs font-mono tracking-widest uppercase">Fetching Live Option Chains & Computing BSM...</span>
                </div>
              ) : partBData ? (
                <ModuleErrorBoundary
                  resetKey={`${activeTab}-${partBData?.data?.liquid?.ticker || ""}-${partBData?.data?.illiquid?.ticker || ""}-${partBData?.data?.liquid?.spot || ""}-${partBData?.data?.illiquid?.spot || ""}-${partBData?.data?.liquid?.pricing_table?.length || 0}-${partBData?.data?.illiquid?.pricing_table?.length || 0}`}
                  fallback={(
                    <EmptyModuleState
                      code="DRV"
                      label="Derivatives Pricing"
                      desc="Derivatives Pricing loaded a runtime error. Reload the tab or reselect instruments to retry."
                    />
                  )}
                >
                  <PartB />
                </ModuleErrorBoundary>
              ) : (
                <EmptyModuleState code="DRV" label="Derivatives Pricing" desc="Options chain, IV surface, Greeks computation, and payoff diagrams for selected underlyings." />
              )
            )}
            {activeTab === "part-c" && (
              <PartC />
            )}
            {activeTab === "part-d" && <PartD />}
          </div>
        </main>
      </div>
    </div>
  )
}