import { useMemo } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, ReferenceLine, Bar,
  ScatterChart, Scatter,
} from "recharts"
import usePortfolioStore from "@/store/usePortfolioStore"

// ─── Design Tokens ────────────────────────────────────────────────────────────
// Blue/amber — neutral comparison palette, no buy/sell bias
const T = {
  // Stock colors
  a:        "#60a5fa",   // blue-400  — liquid stock
  b:        "#fb923c",   // amber-400 — illiquid stock
  aDim:     "#60a5fa18",
  bDim:     "#fb923c18",
  aBorder:  "#60a5fa30",
  bBorder:  "#fb923c30",
  aBg:      "#0d1520",
  bBg:      "#1a1005",

  // UI chrome
  accent:   "#a78bfa",    // violet-400
  accentDim:"#a78bfa15",
  divider:  "#ffffff0f",
  grid:     "#ffffff08",
  axis:     "#ffffff28",
  muted:    "#ffffff40",
  surface:  "#111116",
  surfaceHi:"#16161c",
  bg:       "#0c0c10",

  // Tooltip
  ttBg:     "#0a0a0e",
  ttBorder: "#2a2a35",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { month: "short", day: "numeric" })

const fmt2  = (v) => v != null ? Number(v).toFixed(2) : "—"
const fmt4  = (v) => v != null ? Number(v).toFixed(4) : "—"
const fmtPct= (v) => v != null ? `${Number(v).toFixed(2)}%` : "—"
const fmtCr = (v) => v != null ? `₹${Number(v).toFixed(1)} Cr` : "—"

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
  labelStyle:   { color: T.muted, marginBottom: 4, fontSize: 10 },
  itemStyle:    { fontSize: 11 },
}

// ─── Shared axis props ────────────────────────────────────────────────────────
const axisProps = {
  stroke:     T.axis,
  fontSize:   10,
  tickMargin: 6,
  tick:       { fontFamily: "'DM Mono', monospace", fill: T.muted },
}

// ─── Data builders ────────────────────────────────────────────────────────────
function alignSeries(aDates = [], bDates = [], aVals, bVals) {
  const minLen = Math.min(aDates.length, bDates.length)
  if (!minLen) return []
  const as = aDates.length - minLen
  const bs = bDates.length - minLen
  return Array.from({ length: minLen }, (_, i) => ({
    date:     fmtDate(aDates[as + i]),
    liquid:   aVals?.[as + i] ?? null,
    illiquid: bVals?.[bs + i] ?? null,
  }))
}

function buildPriceVol(lTs, iTs) {
  const ld = lTs?.dates || [], id = iTs?.dates || []
  const n  = Math.min(ld.length, id.length)
  if (!n) return []
  const la = ld.length - n, ia = id.length - n
  return Array.from({ length: n }, (_, k) => ({
    date:          fmtDate(ld[la + k]),
    liquidClose:   lTs?.close?.[la + k] ?? null,
    illiquidClose: iTs?.close?.[ia + k] ?? null,
    liquidVol:     lTs?.rolling_vol_20d?.[la + k] != null
                     ? lTs.rolling_vol_20d[la + k] * 100 : null,
    illiquidVol:   iTs?.rolling_vol_20d?.[ia + k] != null
                     ? iTs.rolling_vol_20d[ia + k] * 100 : null,
  }))
}

const finiteSeries = (arr = []) => arr.filter((v) => Number.isFinite(v))

const percentile = (arr = [], p = 0.75) => {
  const clean = finiteSeries(arr).slice().sort((a, b) => a - b)
  if (!clean.length) return null
  const idx = Math.min(clean.length - 1, Math.floor(p * (clean.length - 1)))
  return clean[idx]
}

const normalPdf = (x, mean, std) => {
  if (!Number.isFinite(std) || std <= 0) return 0
  const z = (x - mean) / std
  return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI))
}

function buildReturnHistogram(lReturns = [], iReturns = [], bins = 26) {
  const l = finiteSeries(lReturns)
  const i = finiteSeries(iReturns)
  const all = [...l, ...i]
  if (!all.length) return []

  let minV = Math.min(...all)
  let maxV = Math.max(...all)
  if (minV === maxV) {
    minV -= 0.01
    maxV += 0.01
  }

  const bw = (maxV - minV) / bins
  const lCounts = Array.from({ length: bins }, () => 0)
  const iCounts = Array.from({ length: bins }, () => 0)

  const toBin = (v) => {
    const idx = Math.floor((v - minV) / bw)
    return Math.max(0, Math.min(bins - 1, idx))
  }

  l.forEach((v) => { lCounts[toBin(v)] += 1 })
  i.forEach((v) => { iCounts[toBin(v)] += 1 })

  const lMean = l.reduce((a, b) => a + b, 0) / l.length
  const iMean = i.reduce((a, b) => a + b, 0) / i.length
  const lStd = Math.sqrt(l.reduce((a, b) => a + (b - lMean) ** 2, 0) / Math.max(1, l.length - 1))
  const iStd = Math.sqrt(i.reduce((a, b) => a + (b - iMean) ** 2, 0) / Math.max(1, i.length - 1))

  return Array.from({ length: bins }, (_, idx) => {
    const left = minV + idx * bw
    const center = left + bw / 2
    return {
      bin: `${(center * 100).toFixed(2)}%`,
      liquidCount: lCounts[idx],
      illiquidCount: iCounts[idx],
      liquidFit: normalPdf(center, lMean, lStd) * l.length * bw,
      illiquidFit: normalPdf(center, iMean, iStd) * i.length * bw,
    }
  })
}

const buildScatter = (volSeries = [], amihudSeries = []) => {
  const n = Math.min(volSeries.length, amihudSeries.length)
  if (!n) return []
  const vs = volSeries.length - n
  const as = amihudSeries.length - n
  const points = []

  for (let k = 0; k < n; k += 1) {
    const vol = volSeries[vs + k]
    const amihud = amihudSeries[as + k]
    if (!Number.isFinite(vol) || !Number.isFinite(amihud)) continue
    points.push({
      x: vol * 100,
      y: amihud * 1e3,
    })
  }
  return points
}

const fitLineAndCorrelation = (points = []) => {
  if (points.length < 2) return { segment: null, r: null }
  const n = points.length
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let sxx = 0
  let syy = 0
  let sxy = 0

  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }

  if (sxx <= 0 || syy <= 0) return { segment: null, r: null }

  const slope = sxy / sxx
  const intercept = meanY - slope * meanX
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)

  return {
    segment: [
      { x: minX, y: slope * minX + intercept },
      { x: maxX, y: slope * maxX + intercept },
    ],
    r: sxy / Math.sqrt(sxx * syy),
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, sub }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <span
        className="text-[10px] font-bold uppercase tracking-[0.25em] shrink-0"
        style={{ color: T.accent }}
      >
        {label}
      </span>
      {sub && (
        <span className="text-[10px] tracking-wider" style={{ color: T.muted }}>
          {sub}
        </span>
      )}
      <div className="flex-1 h-px" style={{ background: T.divider }} />
    </div>
  )
}

function StockBadge({ ticker, variant }) {
  const color  = variant === "liquid" ? T.a : T.b
  const bg     = variant === "liquid" ? T.aDim : T.bDim
  const border = variant === "liquid" ? T.aBorder : T.bBorder
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold px-2.5 py-1 rounded"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      {ticker}
    </span>
  )
}

/** Two-row KPI tile comparing liquid vs illiquid */
function KpiCard({ label, lVal, iVal, lTick, iTick }) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: T.surface, border: `1px solid ${T.divider}` }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-[0.2em]"
        style={{ color: T.muted }}
      >
        {label}
      </span>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-mono truncate" style={{ color: T.a }}>
            {lTick}
          </span>
          <span
            className="text-[15px] font-mono font-semibold tabular-nums"
            style={{ color: "#e8e8f0" }}
          >
            {lVal}
          </span>
        </div>
        <div className="h-px" style={{ background: T.divider }} />
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-mono truncate" style={{ color: T.b }}>
            {iTick}
          </span>
          <span
            className="text-[15px] font-mono font-semibold tabular-nums"
            style={{ color: "#e8e8f0" }}
          >
            {iVal}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Insight panel */
function Insight({ icon, title, children }) {
  return (
    <div
      className="rounded-lg p-5 flex flex-col gap-3"
      style={{ background: T.surface, border: `1px solid ${T.divider}` }}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-sm opacity-80">{icon}</span>}
        <span
          className="text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ color: T.accent }}
        >
          {title}
        </span>
      </div>
      <div className="text-[12px] leading-relaxed space-y-2" style={{ color: "#c0c0d0" }}>
        {children}
      </div>
    </div>
  )
}

/** Chart card wrapper */
function ChartCard({ title, sub, badge, height = 200, children }) {
  return (
    <div
      className="rounded-lg flex flex-col overflow-hidden"
      style={{ background: T.surface, border: `1px solid ${T.divider}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ background: T.surfaceHi, borderBottom: `1px solid ${T.divider}` }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: "#d0d0e0" }}
        >
          {title}
        </span>
        {sub && (
          <span className="text-[9px] font-mono" style={{ color: T.muted }}>
            {sub}
          </span>
        )}
        {badge && (
          <span
            className="text-[9px] font-mono px-2 py-0.5 rounded tracking-wider"
            style={{ background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}30` }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ height }} className="px-3 pt-3 pb-2">
        {children}
      </div>
    </div>
  )
}

/** Mini legend for charts */
function Legend({ lTick, iTick, dashed }) {
  return (
    <div className="flex items-center gap-5 px-1 mb-2">
      {[{ color: T.a, label: lTick }, { color: T.b, label: iTick }].map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <svg width="18" height="3">
            <line
              x1="0" y1="1.5" x2="18" y2="1.5"
              stroke={color} strokeWidth="2"
              strokeDasharray={dashed ? "5 3" : "none"}
            />
          </svg>
          <span className="text-[10px] font-mono" style={{ color }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Summary stats table row */
function Row({ label, lVal, iVal, hi }) {
  return (
    <tr
      className="border-b transition-colors"
      style={{
        borderColor: T.divider,
        background: hi ? "#a78bfa0a" : "transparent",
      }}
    >
      <td
        className="py-2.5 px-5 text-[12px]"
        style={{ color: T.muted }}
      >
        {label}
      </td>
      <td
        className="py-2.5 px-5 text-[12px] font-mono tabular-nums text-right"
        style={{ color: T.a }}
      >
        {lVal ?? "—"}
      </td>
      <td
        className="py-2.5 px-5 text-[12px] font-mono tabular-nums text-right"
        style={{ color: T.b }}
      >
        {iVal ?? "—"}
      </td>
    </tr>
  )
}

// ─── Correlation badge ────────────────────────────────────────────────────────
function CorrBadge({ value }) {
  const v = Number(value)
  const abs = Math.abs(v)
  const label  = abs > 0.3 ? (v > 0 ? "Positive" : "Negative") : "Weak"
  const color  = abs > 0.3 ? (v > 0 ? "#34d399" : "#f87171") : T.muted
  return (
    <span className="font-mono" style={{ color }}>
      {value != null ? Number(value).toFixed(3) : "—"}
      <span className="text-[9px] ml-1.5 font-sans opacity-70">{label}</span>
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PartA() {
  const { partAData } = usePortfolioStore()
  if (!partAData) return null

  const { liquid, illiquid, comparison } = partAData.data

  // Tickers
  const lTick = liquid?.volatility?.ticker  || "LIQUID"
  const iTick = illiquid?.volatility?.ticker || "ILLIQUID"

  // Time-series payloads
  const lVolTs = liquid?.volatility?.timeseries
  const iVolTs = illiquid?.volatility?.timeseries
  const lLiqTs = liquid?.liquidity?.timeseries
  const iLiqTs = illiquid?.liquidity?.timeseries

  // Stats
  const lStat  = liquid?.volatility?.summary_stats   || {}
  const iStat  = illiquid?.volatility?.summary_stats  || {}
  const lLStat = liquid?.liquidity?.summary_stats    || {}
  const iLStat = illiquid?.liquidity?.summary_stats   || {}

  // Correlation
  const corrL = comparison?.correlation_liquid   || {}
  const corrI = comparison?.correlation_illiquid || {}

  // Derived values
  const annVolL = lStat?.annualised_vol_pct ?? comparison?.annualised_vol?.liquid
  const annVolI = iStat?.annualised_vol_pct ?? comparison?.annualised_vol?.illiquid

  // Chart data (memoised)
  const priceVolData  = useMemo(() => buildPriceVol(lVolTs, iVolTs), [lVolTs, iVolTs])
  const logReturnData = useMemo(() =>
    alignSeries(lVolTs?.dates, iVolTs?.dates, lVolTs?.log_returns, iVolTs?.log_returns),
    [lVolTs, iVolTs]
  )
  const turnoverData  = useMemo(() =>
    alignSeries(lLiqTs?.dates, iLiqTs?.dates, lLiqTs?.turnover_ratio, iLiqTs?.turnover_ratio),
    [lLiqTs, iLiqTs]
  )
  const amihudData    = useMemo(() => {
    const scale = (arr) => arr?.map(v => v != null ? v * 1e3 : null)
    return alignSeries(
      lLiqTs?.dates, iLiqTs?.dates,
      scale(lLiqTs?.amihud_ma_scaled_1e7),
      scale(iLiqTs?.amihud_ma_scaled_1e7),
    )
  }, [lLiqTs, iLiqTs])

  const histogramData = useMemo(
    () => buildReturnHistogram(lVolTs?.log_returns, iVolTs?.log_returns),
    [lVolTs, iVolTs]
  )

  const vol75Liquid = useMemo(
    () => percentile(priceVolData.map((d) => d.liquidVol), 0.75),
    [priceVolData]
  )

  const vol75Illiquid = useMemo(
    () => percentile(priceVolData.map((d) => d.illiquidVol), 0.75),
    [priceVolData]
  )

  const scatterPayload = useMemo(() => {
    const liquidPoints = buildScatter(lVolTs?.rolling_vol_20d, lLiqTs?.amihud_ma_scaled_1e7)
    const illiquidPoints = buildScatter(iVolTs?.rolling_vol_20d, iLiqTs?.amihud_ma_scaled_1e7)
    const liquidFit = fitLineAndCorrelation(liquidPoints)
    const illiquidFit = fitLineAndCorrelation(illiquidPoints)
    return {
      liquidPoints,
      illiquidPoints,
      liquidFit,
      illiquidFit,
    }
  }, [lVolTs, iVolTs, lLiqTs, iLiqTs])

  const scatterSubtitle = `r(${lTick})=${fmt4(scatterPayload.liquidFit.r)} | r(${iTick})=${fmt4(scatterPayload.illiquidFit.r)}`

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="space-y-10 pb-12 px-1 animate-in fade-in duration-500"
      style={{ color: "#d8d8e8" }}
    >

      {/* ── 1. INSTRUMENTS ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Active Instruments" sub="Selected pair — NIFTY 50 universe" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: "Liquid Asset",   ticker: lTick, variant: "liquid",
              sub: "Top 25% by avg. 6-month daily turnover",
              color: T.a, dim: T.aDim, border: T.aBorder, bg: T.aBg },
            { label: "Illiquid Asset", ticker: iTick, variant: "illiquid",
              sub: "Bottom 25% by avg. 6-month daily turnover",
              color: T.b, dim: T.bDim, border: T.bBorder, bg: T.bBg },
          ].map(({ label, ticker, variant, sub, color, bg, border }) => (
            <div
              key={variant}
              className="rounded-lg p-5 flex flex-col gap-3"
              style={{ background: bg, border: `1px solid ${border}` }}
            >
              <span
                className="text-[10px] uppercase tracking-[0.2em] font-bold"
                style={{ color: T.muted }}
              >
                {label}
              </span>
              <StockBadge ticker={ticker} variant={variant} />
              <p className="text-[11px] leading-relaxed" style={{ color: T.muted }}>
                {sub}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. KPI ROW ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Key Metrics" sub="6-month window · Annualised" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Annualised Volatility"
            lVal={fmtPct(annVolL)} iVal={fmtPct(annVolI)}
            lTick={lTick} iTick={iTick}
          />
          <KpiCard
            label="Avg Daily Turnover"
            lVal={fmtCr(lLStat?.avg_daily_turnover_cr)}
            iVal={fmtCr(iLStat?.avg_daily_turnover_cr)}
            lTick={lTick} iTick={iTick}
          />
          <KpiCard
            label="Skewness"
            lVal={fmt4(lStat?.skewness)} iVal={fmt4(iStat?.skewness)}
            lTick={lTick} iTick={iTick}
          />
          <KpiCard
            label="Excess Kurtosis"
            lVal={fmt4(lStat?.excess_kurtosis)} iVal={fmt4(iStat?.excess_kurtosis)}
            lTick={lTick} iTick={iTick}
          />
        </div>
      </section>

      {/* ── 3. INSIGHTS ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Statistical Insights" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Volatility Clustering */}
          <Insight title="Volatility Clustering (Ljung-Box)">
            {[
              { ticker: lTick, color: T.a, clustering: liquid?.volatility?.clustering },
              { ticker: iTick, color: T.b, clustering: illiquid?.volatility?.clustering },
            ].map(({ ticker, color, clustering }) => {
              const detected = clustering?.clustering_detected
              const p        = clustering?.ljung_box_pvalue
              return (
                <div key={ticker} className="flex items-start gap-3">
                  <span
                    className="text-[10px] font-mono font-bold shrink-0 mt-0.5"
                    style={{ color }}
                  >
                    {ticker}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span style={{ color: detected ? "#f0c060" : "#9cb8d0" }}>
                      {detected
                        ? "Clustering detected — volatility autocorrelated"
                        : "No significant clustering"}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: T.muted }}>
                      Ljung-Box p = {p != null ? p.toFixed(4) : "N/A"}
                      {p != null && (
                        <span className="ml-2">
                          {p < 0.05 ? "↳ reject H₀ at 5%" : "↳ fail to reject H₀"}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </Insight>

          {/* Vol / Liquidity Correlation */}
          <Insight title="Volatility–Liquidity Correlation">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { ticker: lTick, color: T.a, corr: corrL },
                { ticker: iTick, color: T.b, corr: corrI },
              ].map(({ ticker, color, corr }) => (
                <div key={ticker} className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono font-bold" style={{ color }}>
                    {ticker}
                  </span>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between gap-3">
                      <span style={{ color: T.muted }}>Vol / Turnover</span>
                      <CorrBadge value={corr?.vol_vs_turnover_r} />
                    </div>
                    <div className="flex justify-between gap-3">
                      <span style={{ color: T.muted }}>Vol / Amihud</span>
                      <CorrBadge value={corr?.vol_vs_amihud_r} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Insight>

          {/* Tail Risk */}
          <Insight title="Tail Risk Summary">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px]">
              {[
                { ticker: lTick, color: T.a, s: lStat },
                { ticker: iTick, color: T.b, s: iStat },
              ].map(({ ticker, color, s }) => (
                <div key={ticker} className="flex flex-col gap-1.5">
                  <span className="font-mono font-bold" style={{ color }}>{ticker}</span>
                  <div className="space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span style={{ color: T.muted }}>Kurtosis</span>
                      <span style={{ color: "#e0e0f0" }}>{fmt4(s?.excess_kurtosis)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: T.muted }}>Min Return</span>
                      <span style={{ color: "#f87171" }}>{fmt4(s?.min_return)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: T.muted }}>Max Return</span>
                      <span style={{ color: "#4ade80" }}>{fmt4(s?.max_return)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Insight>

          {/* Liquidity Classification */}
          <Insight title="Liquidity Classification">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px]">
              {[
                { ticker: lTick, color: T.a, s: lLStat },
                { ticker: iTick, color: T.b, s: iLStat },
              ].map(({ ticker, color, s }) => {
                const counts = s?.liq_class_counts || {}
                const total  = Object.values(counts).reduce((a, b) => a + b, 0) || 1
                return (
                  <div key={ticker} className="flex flex-col gap-1.5">
                    <span className="font-mono font-bold" style={{ color }}>{ticker}</span>
                    <div className="space-y-1 font-mono">
                      {Object.entries(counts).map(([cls, n]) => (
                        <div key={cls} className="flex justify-between gap-2">
                          <span className="text-[10px]" style={{ color: T.muted }}>
                            {cls.replace(" (top 25%)", " ↑").replace(" (bottom 25%)", " ↓")}
                          </span>
                          <span style={{ color: "#d0d0e8" }}>
                            {n}
                            <span className="text-[9px] ml-1" style={{ color: T.muted }}>
                              ({Math.round((n / total) * 100)}%)
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Insight>

        </div>
      </section>

      {/* ── 4. SUMMARY STATISTICS TABLE ─────────────────────────────────────── */}
      <section>
        <SectionHeader label="Summary Statistics" sub="Full comparison" />
        <div
          className="rounded-lg overflow-hidden"
          style={{ background: T.surface, border: `1px solid ${T.divider}` }}
        >
          {/* Table header */}
          <div
            className="grid px-4 sm:px-5 py-3"
            style={{
              background: T.surfaceHi,
              borderBottom: `1px solid ${T.divider}`,
              gridTemplateColumns: "1fr auto auto",
              gap: "0 24px",
            }}
          >
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ color: T.muted }}
            >
              Metric
            </span>
            <StockBadge ticker={lTick} variant="liquid" />
            <StockBadge ticker={iTick} variant="illiquid" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left">
              <colgroup>
                <col style={{ width: "50%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
              </colgroup>
              <tbody>
                <Row label="Trading Days"           lVal={lStat?.n_trading_days}             iVal={iStat?.n_trading_days} />
                <Row label="Mean Daily Return"      lVal={fmt4(lStat?.mean_daily_return)}     iVal={fmt4(iStat?.mean_daily_return)} />
                <Row label="Std Dev (Daily)"        lVal={fmt4(lStat?.std_daily_return)}      iVal={fmt4(iStat?.std_daily_return)} />
                <Row label="Skewness"               lVal={fmt4(lStat?.skewness)}              iVal={fmt4(iStat?.skewness)} />
                <Row label="Excess Kurtosis"        lVal={fmt4(lStat?.excess_kurtosis)}       iVal={fmt4(iStat?.excess_kurtosis)} />
                <Row label="Min Daily Return"       lVal={fmt4(lStat?.min_return)}            iVal={fmt4(iStat?.min_return)} />
                <Row label="Max Daily Return"       lVal={fmt4(lStat?.max_return)}            iVal={fmt4(iStat?.max_return)} />
                <Row label="Ann. Volatility (hist)" lVal={fmtPct(annVolL)}                   iVal={fmtPct(annVolI)}         hi />
                <Row label="Avg Daily Turnover"     lVal={fmtCr(lLStat?.avg_daily_turnover_cr)} iVal={fmtCr(iLStat?.avg_daily_turnover_cr)} />
                <Row label="Avg Amihud Illiquidity" lVal={fmt4(lLStat?.avg_amihud_scaled_1e7)}  iVal={fmt4(iLStat?.avg_amihud_scaled_1e7)}  hi />
                <Row label="Turnover Ratio Mean"    lVal={fmt4(lLStat?.turnover_ratio_mean)}  iVal={fmt4(iLStat?.turnover_ratio_mean)} />
                <Row label="Turnover Ratio Std"     lVal={fmt4(lLStat?.turnover_ratio_std)}   iVal={fmt4(iLStat?.turnover_ratio_std)} />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 5. CHARTS ────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader label="Time Series Analysis" sub="250-day aligned window" />

        {/* Row 1 */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">

          <ChartCard title="Daily Log Returns" badge="Log Ret" height={220}>
            <Legend lTick={lTick} iTick={iTick} />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={logReturnData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={45} />
                <YAxis {...axisProps} width={52}
                  tickFormatter={v => `${(v * 100).toFixed(1)}%`} />
                <ReferenceLine y={0} stroke={T.axis} strokeDasharray="3 3" />
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [`${(v * 100).toFixed(3)}%`, n]} />
                <Line type="monotone" dataKey="liquid"
                  stroke={T.a} strokeWidth={1.2} dot={false} name={lTick} />
                <Line type="monotone" dataKey="illiquid"
                  stroke={T.b} strokeWidth={1.2} dot={false} name={iTick} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="20d Realized Volatility" badge="Ann. %" height={220}>
            <Legend lTick={lTick} iTick={iTick} />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={priceVolData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={45} />
                <YAxis {...axisProps} width={52} tickFormatter={v => `${v.toFixed(1)}%`} />
                {vol75Liquid != null && (
                  <ReferenceLine
                    y={vol75Liquid}
                    stroke={T.a}
                    strokeDasharray="6 4"
                    label={{ value: `${lTick} P75`, fill: T.a, fontSize: 9, position: "insideTopRight" }}
                  />
                )}
                {vol75Illiquid != null && (
                  <ReferenceLine
                    y={vol75Illiquid}
                    stroke={T.b}
                    strokeDasharray="6 4"
                    label={{ value: `${iTick} P75`, fill: T.b, fontSize: 9, position: "insideTopLeft" }}
                  />
                )}
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [`${v?.toFixed(2)}%`, n]} />
                <Line type="monotone" dataKey="liquidVol"
                  stroke={T.a} strokeWidth={1.5} dot={false} name={`${lTick} Vol`} />
                <Line type="monotone" dataKey="illiquidVol"
                  stroke={T.b} strokeWidth={1.5} dot={false} name={`${iTick} Vol`} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          <ChartCard title="Turnover Ratio" badge="Liq. Proxy" height={220}>
            <Legend lTick={lTick} iTick={iTick} />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={turnoverData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={45} />
                <YAxis {...axisProps} width={46} tickFormatter={v => v.toFixed(1)} />
                <ReferenceLine y={1} stroke={T.axis} strokeDasharray="4 4"
                  label={{ value: "Avg=1", fill: T.muted, fontSize: 9, position: "right" }} />
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [v?.toFixed(4), n]} />
                <Line type="monotone" dataKey="liquid"
                  stroke={T.a} strokeWidth={1.5} dot={false} name={`${lTick} Ratio`} />
                <Line type="monotone" dataKey="illiquid"
                  stroke={T.b} strokeWidth={1.5} dot={false} name={`${iTick} Ratio`} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Amihud Illiquidity (20d MA)" badge="×10⁻¹⁰" height={220}>
            <Legend lTick={lTick} iTick={iTick} dashed />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={amihudData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={45} />
                <YAxis {...axisProps} width={52}
                  tickFormatter={v => v.toExponential(1)} />
                <Tooltip {...tooltipProps}
                  formatter={(v, n) => [v?.toExponential(3), n]} />
                <Line type="monotone" dataKey="liquid"
                  stroke={T.a} strokeWidth={1.5} strokeDasharray="5 3" dot={false}
                  name={`${lTick} Amihud`} />
                <Line type="monotone" dataKey="illiquid"
                  stroke={T.b} strokeWidth={1.5} strokeDasharray="5 3" dot={false}
                  name={`${iTick} Amihud`} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">

          <ChartCard title="Frequency Distribution of Log Returns" badge="Histogram + Normal Fit" height={250}>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={histogramData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false} />
                <XAxis dataKey="bin" {...axisProps} minTickGap={28} />
                <YAxis {...axisProps} width={46} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(v, name) => [fmt2(v), name]}
                />
                <Bar dataKey="liquidCount" name={`${lTick} Freq`} fill={T.aDim} stroke={T.a} strokeWidth={1} />
                <Bar dataKey="illiquidCount" name={`${iTick} Freq`} fill={T.bDim} stroke={T.b} strokeWidth={1} />
                <Line type="monotone" dataKey="liquidFit" dot={false} stroke={T.a} strokeWidth={1.4} name={`${lTick} Normal`} />
                <Line type="monotone" dataKey="illiquidFit" dot={false} stroke={T.b} strokeWidth={1.4} name={`${iTick} Normal`} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Rolling Volatility vs Amihud Illiquidity"
            sub={scatterSubtitle}
            badge="OLS Dashed"
            height={250}
          >
            <ResponsiveContainer width="100%" height={210}>
              <ScatterChart margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} />
                <XAxis
                  type="number"
                  dataKey="x"
                  {...axisProps}
                  name="Rolling Volatility (%)"
                  tickFormatter={(v) => `${v.toFixed(1)}%`}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  {...axisProps}
                  name="Amihud (x10^-10)"
                  tickFormatter={(v) => v.toExponential(1)}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={(v, n) => [Number(v).toExponential ? Number(v).toExponential(3) : v, n]}
                  labelFormatter={() => "Volatility vs Illiquidity"}
                />
                <Scatter name={lTick} data={scatterPayload.liquidPoints} fill={T.a} fillOpacity={0.55} />
                <Scatter name={iTick} data={scatterPayload.illiquidPoints} fill={T.b} fillOpacity={0.55} />
                {scatterPayload.liquidFit.segment && (
                  <ReferenceLine segment={scatterPayload.liquidFit.segment} stroke={T.a} strokeDasharray="6 4" />
                )}
                {scatterPayload.illiquidFit.segment && (
                  <ReferenceLine segment={scatterPayload.illiquidFit.segment} stroke={T.b} strokeDasharray="6 4" />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>
      </section>

    </div>
  )
}