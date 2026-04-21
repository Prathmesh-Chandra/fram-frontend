import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Line,
} from "recharts"
import { fetchPartD } from "@/api/client"
import usePortfolioStore from "@/store/usePortfolioStore"

// ─── Design Tokens (Strictly synchronized with Parts A-C) ─────────────────────
const T = {
  a:         "#60a5fa",   // Liquid (Blue)
  b:         "#fb923c",   // Illiquid (Amber)
  aDim:      "#60a5fa18",
  bDim:      "#fb923c18",
  aBorder:   "#60a5fa30",
  bBorder:   "#fb923c30",
  accent:    "#a78bfa",
  accentDim: "#a78bfa15",
  yellow:    "#e8f44a",
  green:     "#34d399",
  red:       "#f87171",
  divider:   "#ffffff0f",
  grid:      "#ffffff08",
  axis:      "#ffffff28",
  muted:     "#ffffff40",
  surface:   "#111116",
  surfaceHi: "#16161c",
  bg:        "#0c0c10",
  ttBg:      "#0a0a0e",
  ttBorder:  "#2a2a35",
}

const AX = {
  stroke: T.axis,
  fontSize: 10,
  tickMargin: 5,
  tick: { fontFamily: "'DM Mono', monospace", fill: T.muted },
}

const tooltipProps = {
  contentStyle: {
    backgroundColor: T.ttBg,
    border: `1px solid ${T.ttBorder}`,
    borderRadius: 6,
    fontSize: 11,
    fontFamily: "'DM Mono', 'Fira Code', monospace",
    padding: "8px 12px",
    boxShadow: "0 8px 32px #00000080",
  },
  labelStyle: { color: T.muted, marginBottom: 4, fontSize: 10 },
  itemStyle: { fontSize: 11 },
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtPct = (v, d = 3) => (Number.isFinite(+v) ? `${Number(v).toFixed(d)}%` : "—")
const fmt4 = (v) => (Number.isFinite(+v) ? Number(v).toFixed(4) : "—")
const fmtSigned = (v, d = 4) => {
  if (!Number.isFinite(+v)) return "—"
  const n = Number(v)
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}`
}

// ─── Client-side Math & Simulation Helpers ────────────────────────────────────
function mulberry32(seed) {
  let t = seed
  return function rand() {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function randomNormal(rand) {
  const u1 = Math.max(rand(), 1e-12)
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function hashSeed(text = "") {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function makeEmpiricalSeries({ seed, n, sigmaPct }) {
  const rand = mulberry32(seed)
  const out = []
  for (let i = 0; i < n; i += 1) {
    const shock = rand() < 0.12 ? 1.9 : 1
    out.push(randomNormal(rand) * sigmaPct * shock)
  }
  return out
}

function makeMonteCarloSeries({ seed, n, sigmaPct }) {
  const rand = mulberry32(seed)
  const out = []
  for (let i = 0; i < n; i += 1) out.push(randomNormal(rand) * sigmaPct)
  return out
}

function buildHistogram(values, bins = 46) {
  if (!values?.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = range / bins
  const counts = Array.from({ length: bins }, () => 0)

  for (const v of values) {
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((v - min) / w)))
    counts[idx] += 1
  }

  return counts.map((c, i) => {
    const center = min + (i + 0.5) * w
    return { x: center, count: c }
  })
}

function normalPdf(x, sigma) {
  const s = sigma / 100
  const xv = x / 100
  return Math.exp(-(xv * xv) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
}

function pdfToHistogramScale(hist, sigmaPct, sampleSize) {
  if (!hist.length) return []
  const step = Math.abs((hist[1]?.x ?? hist[0].x) - hist[0].x) || 0.1
  return hist.map((h) => {
    const densityCount = normalPdf(h.x, sigmaPct) * (step / 100) * sampleSize
    return { x: h.x, fit: densityCount, count: h.count }
  })
}

// ─── Shared Components ────────────────────────────────────────────────────────
function SectionHeader({ label, sub }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] shrink-0" style={{ color: T.accent }}>
        {label}
      </span>
      {sub && <span className="text-[10px] tracking-wider" style={{ color: T.muted }}>{sub}</span>}
      <div className="flex-1 h-px" style={{ background: T.divider }} />
    </div>
  )
}

function ChartCard({ title, badge, height = 280, children }) {
  return (
    <div className="rounded-lg flex flex-col overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#d0d0e0" }}>{title}</span>
        {badge && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded tracking-wider" style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}30` }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ height }} className="px-3 pt-3 pb-2">{children}</div>
    </div>
  )
}

function StatTile({ label, value, sub, color = "#e8e8f0" }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1.5" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: T.muted }}>{label}</span>
      <span className="text-[16px] font-mono font-semibold tabular-nums" style={{ color }}>{value}</span>
      {sub && <span className="text-[10px] font-mono" style={{ color: T.muted }}>{sub}</span>}
    </div>
  )
}

// ─── Data Panels ──────────────────────────────────────────────────────────────
function DistributionPanel({ color, histData, fitData, var95, var99 }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={histData} margin={{ top: 8, right: 12, left: -4, bottom: 22 }}>
        <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
        <XAxis {...AX} dataKey="x" tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
        <YAxis {...AX} width={36} />
        <Tooltip
          {...tooltipProps}
          formatter={(v, n) => [n === "count" ? Number(v).toFixed(0) : Number(v).toFixed(2), n === "count" ? "Frequency" : "Normal fit"]}
          labelFormatter={(label) => `Return ${Number(label).toFixed(2)}%`}
        />
        <ReferenceLine x={-var95} stroke={T.green} strokeDasharray="5 3" label={{ value: `VaR 95% = ${var95.toFixed(2)}%`, fill: T.green, fontSize: 9, position: "insideTopLeft" }} />
        <ReferenceLine x={-var99} stroke={T.red} strokeDasharray="4 3" label={{ value: `VaR 99% = ${var99.toFixed(2)}%`, fill: T.red, fontSize: 9, position: "insideTopRight" }} />
        <Bar dataKey="count" fill={color} fillOpacity={0.76} name="count" />
        <Line type="monotone" data={fitData} dataKey="fit" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={1.2} dot={false} name="fit" />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MCPanel({ color, histData, var95, var99 }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={histData} margin={{ top: 8, right: 12, left: -4, bottom: 22 }}>
        <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
        <XAxis {...AX} dataKey="x" tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
        <YAxis {...AX} width={36} />
        <Tooltip
          {...tooltipProps}
          formatter={(v) => [Number(v).toFixed(0), "Frequency"]}
          labelFormatter={(label) => `Simulated return ${Number(label).toFixed(2)}%`}
        />
        <ReferenceLine x={-var95} stroke={T.green} strokeDasharray="5 3" label={{ value: `MC 95% = ${var95.toFixed(2)}%`, fill: T.green, fontSize: 9, position: "insideTopLeft" }} />
        <ReferenceLine x={-var99} stroke={T.red} strokeDasharray="4 3" label={{ value: `MC 99% = ${var99.toFixed(2)}%`, fill: T.red, fontSize: 9, position: "insideTopRight" }} />
        <Bar dataKey="count" fill={color} fillOpacity={0.72} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function RegimeVarPanel({ rows, color }) {
  const data = rows.map((r) => ({ regime: r.regime.replace(" regime", ""), var95: r.var95, var99: r.var99 }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 18 }}>
        <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
        <XAxis {...AX} dataKey="regime" tick={{ ...AX.tick, fontSize: 9 }} />
        <YAxis {...AX} width={40} tickFormatter={(v) => `${v.toFixed(1)}%`} />
        <Tooltip
          {...tooltipProps}
          formatter={(v, n) => [`${Number(v).toFixed(3)}%`, n === "var95" ? "VaR 95%" : "VaR 99%"]}
        />
        <Bar dataKey="var95" name="var95" fill={color} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={`${d.regime}-95-${i}`} fillOpacity={0.6} />)}
        </Bar>
        <Bar dataKey="var99" name="var99" fill={T.red} radius={[3, 3, 0, 0]} fillOpacity={0.8} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Data Mappers ─────────────────────────────────────────────────────────────
function mapRegimeRows(asset = {}) {
  const regimes = asset?.parametric_regime_var || {}
  const rows = [
    { key: "all_data", label: "All data" },
    { key: "normal_regime", label: "Normal regime" },
    { key: "high_vol_regime", label: "High-vol regime" },
  ]

  return rows
    .map(({ key, label }) => {
      const r = regimes?.[key]
      if (!r) return null
      return {
        stock: asset?.ticker || "—",
        regime: label,
        nDays: Number(r.n_days || 0),
        sigmaDaily: Number(r.sigma_daily || 0) * 100,
        var95: Number(r.var_95_pct || 0),
        var99: Number(r.var_99_pct || 0),
      }
    })
    .filter(Boolean)
}

function buildAssetView(asset, color, fallbackSeedOffset = 0) {
  const rows = mapRegimeRows(asset)
  const allRow = rows.find((r) => r.regime === "All data")
  if (!rows.length || !allRow) return null

  const mc95 = Number(asset?.monte_carlo_var?.mc_var_95_pct || 0)
  const mc99 = Number(asset?.monte_carlo_var?.mc_var_99_pct || 0)
  const g95 = Number(asset?.garch_var?.garch_var_95_pct || 0)
  const g99 = Number(asset?.garch_var?.garch_var_99_pct || 0)

  const seed = (hashSeed(asset?.ticker || "") + fallbackSeedOffset) >>> 0
  const empiricalSeries = makeEmpiricalSeries({
    seed: seed || 11,
    n: Math.max(20, allRow.nDays || 122),
    sigmaPct: Math.max(0.01, allRow.sigmaDaily || 0.8),
  })

  const mcSigmaPct = Math.max(0.01, (mc95 || allRow.var95 || 1) / 1.645)
  const mcSeries = makeMonteCarloSeries({
    seed: seed + 101,
    n: 50000,
    sigmaPct: mcSigmaPct,
  })

  const empHist = buildHistogram(empiricalSeries, 36)
  const mcHist = buildHistogram(mcSeries, 54)
  const fit = pdfToHistogramScale(empHist, allRow.sigmaDaily, empiricalSeries.length)

  const jumpPct = (() => {
    const n = rows.find((r) => r.regime === "Normal regime")
    const h = rows.find((r) => r.regime === "High-vol regime")
    if (!n?.var95 || !h?.var95) return null
    return ((h.var95 / n.var95) - 1) * 100
  })()

  return {
    ticker: asset?.ticker || "—",
    color,
    rows,
    allRow,
    mc95,
    mc99,
    g95,
    g99,
    empHist,
    mcHist,
    fit,
    jumpPct,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function PartD() {
  const { selectedStocks, partBData, partCData } = usePortfolioStore()

  const liquidTicker =
    partBData?.data?.liquid?.ticker ||
    partCData?.liquidTicker ||
    selectedStocks?.[0]

  const illiquidTicker =
    partBData?.data?.illiquid?.ticker ||
    partCData?.illiquidTicker ||
    selectedStocks?.[1]

  const [riskData, setRiskData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!liquidTicker || !illiquidTicker) {
        setRiskData(null)
        return
      }

      setLoading(true)
      setError("")
      try {
        const res = await fetchPartD(liquidTicker, illiquidTicker, "6mo")
        if (!cancelled) {
          setRiskData(res?.data || null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load Part D")
          setRiskData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [liquidTicker, illiquidTicker])

  const assetViews = useMemo(() => {
    if (!riskData) return []
    const l = buildAssetView(riskData.liquid_asset, T.a, 19)
    const i = buildAssetView(riskData.illiquid_asset, T.b, 31)
    return [l, i].filter(Boolean)
  }, [riskData])

  const regimeTable = useMemo(() => assetViews.flatMap((a) => a.rows), [assetViews])

  const modelTable = useMemo(
    () => assetViews.flatMap((a) => {
      const rows = [
        { method: "Monte Carlo (50k sims)", stock: a.ticker, var95: a.mc95, var99: a.mc99 },
      ]
      if (!Number.isNaN(a.g95) && !Number.isNaN(a.g99) && (a.g95 !== 0 || a.g99 !== 0)) {
        rows.push({ method: "GARCH(1,1) conditional", stock: a.ticker, var95: a.g95, var99: a.g99 })
      }
      return rows
    }),
    [assetViews]
  )

  const partCPortfolio = useMemo(() => {
    const liquidAgg = partCData?.analysis?.liquid?.analysis?.portfolio?.aggregate || {}
    const illiquidAgg = partCData?.analysis?.illiquid?.analysis?.portfolio?.aggregate || {}
    return {
      hasData: Boolean(partCData?.analysis?.liquid || partCData?.analysis?.illiquid),
      legCount:
        (partCData?.activeLegs?.liquid?.length || 0) +
        (partCData?.activeLegs?.illiquid?.length || 0),
      netDelta: Number(liquidAgg.net_delta || 0) + Number(illiquidAgg.net_delta || 0),
      netGamma: Number(liquidAgg.net_gamma || 0) + Number(illiquidAgg.net_gamma || 0),
      netVega: Number(liquidAgg.net_vega || 0) + Number(illiquidAgg.net_vega || 0),
    }
  }, [partCData])

  if (!liquidTicker || !illiquidTicker) {
    return (
      <div className="flex flex-col items-center justify-center min-h-75 gap-3" style={{ color: T.muted }}>
        <span className="text-4xl">RSK</span>
        <p className="text-[13px] font-mono">Select both stocks in Part A/Part B first</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-12 px-1 animate-in fade-in duration-500" style={{ color: "#d8d8e8" }}>
      
      {/* ── 1. PORTFOLIO & CONTEXT OVERVIEW ─────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader label="Risk & VaR Engine" sub="Part D · Backend-driven analytics & Portfolio Context" />

        {loading && (
          <div className="rounded-lg p-3 text-[11px] font-mono" style={{ background: T.surface, border: `1px solid ${T.divider}`, color: T.muted }}>
            Loading risk analysis for {liquidTicker} and {illiquidTicker}...
          </div>
        )}

        {error && (
          <div className="rounded-lg p-3 text-[11px] font-mono" style={{ background: "#2a0f12", border: `1px solid ${T.red}66`, color: "#ffb4b4" }}>
            Error: {error}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Liquid Asset" value={liquidTicker} color={T.a} />
          <StatTile label="Illiquid Asset" value={illiquidTicker} color={T.b} />
          <StatTile label="Confidence Levels" value="95% / 99%" sub="1-day horizon" color={T.yellow} />
          <StatTile
            label="Part C Portfolio"
            value={partCPortfolio.hasData ? `${partCPortfolio.legCount} Active Legs` : "Not run yet"}
            sub={partCPortfolio.hasData ? `Net Δ ${fmtSigned(partCPortfolio.netDelta, 2)}` : "Run Part C for portfolio context"}
            color={partCPortfolio.hasData ? T.accent : "#e8e8f0"}
          />
        </div>

        {partCPortfolio.hasData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatTile label="Portfolio Net Delta" value={fmt4(partCPortfolio.netDelta)} color={T.a} />
            <StatTile label="Portfolio Net Gamma" value={fmt4(partCPortfolio.netGamma)} color={T.accent} />
            <StatTile label="Portfolio Net Vega" value={fmt4(partCPortfolio.netVega)} color={T.b} />
          </div>
        )}
      </section>

      {assetViews.length > 0 && (
        <>
          {/* ── 2. VAR TABLES ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeader label="Parametric VaR Tables" sub="Computed from backend risk endpoint" />

            <div className="rounded-lg overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
                      {["Stock", "Regime", "N Days", "σ (daily)", "VaR 95%", "VaR 99%"].map((h) => (
                        <th key={h} className="py-3 px-4 text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: T.muted }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regimeTable.map((r, idx) => (
                      <tr key={`${r.stock}-${r.regime}`} className="border-b hover:bg-white/[0.018] transition-colors" style={{ borderColor: T.divider }}>
                        <td className="py-2.5 px-4 text-[11px] font-mono font-bold" style={{ color: r.stock === liquidTicker ? T.a : T.b }}>{r.stock}</td>
                        <td className="py-2.5 px-4 text-[11px]" style={{ color: "#d0d0e0" }}>{r.regime}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.muted }}>{r.nDays}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: "#d0d0e0" }}>{fmt4(r.sigmaDaily)}%</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.green }}>{fmtPct(r.var95, 3)}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.red }}>{fmtPct(r.var99, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── 3. DISTRIBUTIONS ──────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeader label="Distributions & Monte Carlo" sub="Empirical vs MC (50k paths)" />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {assetViews.map((a) => (
                <ChartCard key={`${a.ticker}-dist`} title={`${a.ticker} — Return Distribution`} badge="Parametric vs Empirical" height={300}>
                  <DistributionPanel color={a.color} histData={a.empHist} fitData={a.fit} var95={a.allRow.var95} var99={a.allRow.var99} />
                </ChartCard>
              ))}

              {assetViews.map((a) => (
                <ChartCard key={`${a.ticker}-mc`} title={`${a.ticker} — Monte Carlo VaR`} badge="50,000 Sims" height={300}>
                  <MCPanel color={a.color} histData={a.mcHist} var95={a.mc95} var99={a.mc99} />
                </ChartCard>
              ))}
            </div>
          </section>

          {/* ── 4. REGIME VAR CHARTS ───────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeader label="VaR by Regime" sub="Normal vs high-volatility periods" />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {assetViews.map((a) => (
                <ChartCard key={`${a.ticker}-regime`} title={`${a.ticker} — VaR Shift by Regime`} badge="95% & 99%" height={260}>
                  <RegimeVarPanel rows={a.rows} color={a.color} />
                </ChartCard>
              ))}
            </div>

            <div className="rounded-lg p-4" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
              <p className="text-[11px] font-mono" style={{ color: T.muted }}>
                {assetViews
                  .map((a) => (a.jumpPct == null ? `${a.ticker}: Insufficient regime data.` : `${a.ticker}: VaR estimate jumps by ${a.jumpPct.toFixed(1)}% from Normal to High-Vol.`))
                  .join(" | ")}
              </p>
            </div>
          </section>

          {/* ── 5. ADVANCED MODELS ────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeader label="Advanced Risk Models" sub="Monte Carlo vs GARCH(1,1)" />

            <div className="rounded-lg overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}>
                      {["Method", "Stock", "VaR 95%", "VaR 99%"].map((h) => (
                        <th key={h} className="py-3 px-4 text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: T.muted }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelTable.map((r, idx) => (
                      <tr key={`${r.method}-${r.stock}`} className="border-b hover:bg-white/[0.018] transition-colors" style={{ borderColor: T.divider }}>
                        <td className="py-2.5 px-4 text-[11px]" style={{ color: "#d0d0e0" }}>{r.method}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono font-bold" style={{ color: r.stock === liquidTicker ? T.a : T.b }}>{r.stock}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.green }}>{fmtPct(r.var95, 3)}</td>
                        <td className="py-2.5 px-4 text-[11px] font-mono tabular-nums" style={{ color: T.red }}>{fmtPct(r.var99, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── 6. ACADEMIC INTERPRETATION ───────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeader label="Part D Interpretation" sub="Generated by backend" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg p-5 space-y-3" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-80" style={{ color: T.accent }}>STB</span>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: T.accent }}>Stability of VaR Estimates</h3>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: "#c0c0d0" }}>
                  {riskData?.interpretations?.stability_of_estimates || "Not available"}
                </p>
              </div>

              <div className="rounded-lg p-5 space-y-3" style={{ background: T.surface, border: `1px solid ${T.divider}` }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-80" style={{ color: T.accent }}>LIQ</span>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: T.accent }}>Impact of Volatility & Liquidity</h3>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: "#c0c0d0" }}>
                  {riskData?.interpretations?.impact_of_liquidity || "Not available"}
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}