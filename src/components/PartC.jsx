/**
 * PartC.jsx
 * =========
 * Part C: Portfolio Construction, Greeks & Hedging
 *
 * New in this version vs previous:
 *  - Cross-stock portfolio: user builds ONE portfolio spanning BOTH stocks
 *  - BSM Greeks vs Strike curves computed entirely client-side (no new backend)
 *  - Position-delta bar chart per stock (matching reference images)
 *  - Extra data pulled from partBData already loaded in Zustand store
 *  - /portfolio/analyze called once per stock with that stock's legs
 *  - Combined view merges both results
 */

import { useState, useMemo, useCallback } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
  LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts"
import { fetchPartC } from "@/api/client"
import usePortfolioStore from "@/store/usePortfolioStore"

// ─── Design Tokens ──────────────────────────────────────────────────────────────
const T = {
  a:         "#60a5fa",
  b:         "#fb923c",
  aDim:      "#60a5fa18",
  bDim:      "#fb923c18",
  aBorder:   "#60a5fa30",
  bBorder:   "#fb923c30",
  accent:    "#a78bfa",
  accentDim: "#a78bfa15",
  yellow:    "#e8f44a",
  yellowDim: "#e8f44a12",
  green:     "#34d399",
  greenDim:  "#34d39918",
  red:       "#f87171",
  redDim:    "#f8717118",
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

// ─── Formatters ─────────────────────────────────────────────────────────────────
const fmt2   = (v) => (Number.isFinite(+v) ? Number(v).toFixed(2)  : "—")
const fmt4   = (v) => (Number.isFinite(+v) ? Number(v).toFixed(4)  : "—")
const fmtPct = (v) => (Number.isFinite(+v) ? `${Number(v).toFixed(2)}%` : "—")
const fmtINR = (v) => (Number.isFinite(+v) ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—")
const fmtSgn = (v) => (Number.isFinite(+v) ? (v >= 0 ? `+${Number(v).toFixed(2)}` : Number(v).toFixed(2)) : "—")

const TTStyle = {
  contentStyle: { backgroundColor: T.ttBg, border: `1px solid ${T.ttBorder}`, borderRadius: 6, fontSize: 11, fontFamily: "'DM Mono','Fira Code',monospace", padding: "8px 12px", boxShadow: "0 8px 32px #00000080" },
  labelStyle:  { color: T.muted, marginBottom: 4, fontSize: 10 },
  itemStyle:   { fontSize: 11 },
}
const AX = { stroke: T.axis, fontSize: 10, tickMargin: 5, tick: { fontFamily: "'DM Mono',monospace", fill: T.muted } }

// ─── Client-side BSM math ───────────────────────────────────────────────────────
function normCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x) / Math.SQRT2)
  return 0.5*(1+sign*(1-t*(a1+t*(a2+t*(a3+t*(a4+t*a5))))*Math.exp(-x*x/2)))
}
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI) }

function bsmGreeks(S, K, T_yr, r, sigma, type) {
  if (T_yr<=0||sigma<=0||S<=0||K<=0) return null
  const sqT = Math.sqrt(T_yr)
  const d1  = (Math.log(S/K)+(r+0.5*sigma*sigma)*T_yr)/(sigma*sqT)
  const d2  = d1-sigma*sqT
  const isC = type==="call"
  const nd1 = normPDF(d1)
  const delta = isC ? normCDF(d1) : normCDF(d1)-1
  const gamma = nd1/(S*sigma*sqT)
  const vega  = S*sqT*nd1/100          // per 1% σ
  const theta = (-(S*nd1*sigma)/(2*sqT)-r*K*Math.exp(-r*T_yr)*(isC?normCDF(d2):normCDF(-d2)))/365
  return { delta:+delta.toFixed(5), gamma:+gamma.toFixed(7), vega:+vega.toFixed(5), theta:+theta.toFixed(5) }
}

function buildGreeksCurve(spot, sigma, r, T_days, N=80) {
  if (!spot||!sigma||!T_days) return { call:[], put:[] }
  const T_yr = T_days/365
  const lo = spot*0.75, hi = spot*1.25, step=(hi-lo)/(N-1)
  const call=[], put=[]
  for (let i=0;i<N;i++) {
    const K = +(lo+i*step).toFixed(2)
    const cg = bsmGreeks(spot,K,T_yr,r,sigma,"call")
    const pg = bsmGreeks(spot,K,T_yr,r,sigma,"put")
    if (cg&&pg) { call.push({strike:K,...cg}); put.push({strike:K,...pg}) }
  }
  return { call, put }
}

function mergeCurves(callArr, putArr, key) {
  const map = new Map()
  callArr.forEach(p=>map.set(p.strike,{strike:p.strike,call:p[key]}))
  putArr.forEach(p=>{ const e=map.get(p.strike)||{strike:p.strike}; e.put=p[key]; map.set(p.strike,e) })
  return Array.from(map.values()).sort((a,b)=>a.strike-b.strike)
}

// ─── API ────────────────────────────────────────────────────────────────────────
async function callPortfolioAPI(payload) {
  return fetchPartC(payload)
}

// ─── Shared sub-components ──────────────────────────────────────────────────────
function SectionHeader({ label, sub }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] shrink-0" style={{color:T.accent}}>{label}</span>
      {sub&&<span className="text-[10px] tracking-wider" style={{color:T.muted}}>{sub}</span>}
      <div className="flex-1 h-px" style={{background:T.divider}}/>
    </div>
  )
}

function ChartCard({ title, badge, sub, height=200, children, className="" }) {
  return (
    <div className={`rounded-lg flex flex-col overflow-hidden ${className}`} style={{background:T.surface,border:`1px solid ${T.divider}`}}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{color:"#d0d0e0"}}>{title}</span>
          {sub&&<span className="text-[9px] font-mono" style={{color:T.muted}}>{sub}</span>}
        </div>
        {badge&&<span className="text-[9px] font-mono px-2 py-0.5 rounded tracking-wider" style={{background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}30`}}>{badge}</span>}
      </div>
      <div style={{height}} className="px-3 pt-3 pb-2">{children}</div>
    </div>
  )
}

function MetricTile({ label, value, sub, color, glow }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1.5" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{color:T.muted}}>{label}</span>
      <span className="text-[17px] font-mono font-semibold tabular-nums" style={{color:color||"#e8e8f0",textShadow:glow?`0 0 14px ${color}60`:"none"}}>{value}</span>
      {sub&&<span className="text-[10px] font-mono" style={{color:T.muted}}>{sub}</span>}
    </div>
  )
}

function InsightCard({ icon, title, children }) {
  return (
    <div className="rounded-lg p-5 flex flex-col gap-3" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
      <div className="flex items-center gap-2">
        <span className="text-sm opacity-80">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{color:T.accent}}>{title}</span>
      </div>
      <div className="text-[12px] leading-relaxed space-y-2" style={{color:"#c0c0d0"}}>{children}</div>
    </div>
  )
}

function StockBadge({ ticker, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded"
      style={{color,background:color+"18",border:`1px solid ${color}30`}}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background:color}}/>{ticker}
    </span>
  )
}

// ─── LegRow ─────────────────────────────────────────────────────────────────────
function LegRow({ row, qty, onQtyChange, stockColor }) {
  const tc = row.option_type?.toUpperCase()==="CALL" ? T.green : T.red
  return (
    <tr className="border-b hover:bg-white/[0.018] transition-colors" style={{borderColor:T.divider}}>
      <td className="py-2 px-3 text-[10px] font-mono font-bold" style={{color:stockColor}}>{row._ticker}</td>
      <td className="py-2 px-3 text-[11px] font-mono font-bold" style={{color:tc}}>{row.option_type?.toUpperCase()}</td>
      <td className="py-2 px-3 text-[11px] font-mono" style={{color:T.muted}}>{row.moneyness_label||"—"}</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums" style={{color:"#c0c0d0"}}>{row.target_maturity_days}d</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:"#c0c0d0"}}>{fmt2(row.strike)}</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.yellow}}>{fmt2(row.bsm_price_hist_vol)}</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.a}}>{fmt4(row.delta)}</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.accent}}>{fmt4(row.gamma)}</td>
      <td className="py-2 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.b}}>{fmt4(row.vega)}</td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <button onClick={()=>onQtyChange(qty-1)} className="w-6 h-6 rounded text-[13px] font-bold flex items-center justify-center hover:bg-white/10" style={{color:T.red,border:`1px solid ${T.red}30`}}>−</button>
          <input type="number" value={qty} onChange={e=>onQtyChange(parseInt(e.target.value,10)||0)}
            className="w-14 h-6 text-center text-[11px] font-mono rounded outline-none"
            style={{background:qty!==0?(qty>0?T.greenDim:T.redDim):T.bg, color:qty!==0?(qty>0?T.green:T.red):T.muted, border:`1px solid ${qty!==0?(qty>0?T.green+"40":T.red+"40"):T.divider}`}}/>
          <button onClick={()=>onQtyChange(qty+1)} className="w-6 h-6 rounded text-[13px] font-bold flex items-center justify-center hover:bg-white/10" style={{color:T.green,border:`1px solid ${T.green}30`}}>+</button>
        </div>
      </td>
    </tr>
  )
}

// ─── GreeksCurveChart ───────────────────────────────────────────────────────────
function GreekCurveChart({ data, spot, tickFmt }) {
  if (!data?.length) return <div className="h-full grid place-items-center text-[10px] font-mono" style={{color:T.muted}}>No data</div>
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{top:4,right:4,left:0,bottom:4}}>
        <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false}/>
        <XAxis dataKey="strike" {...AX} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(1)}k`:String(v)} minTickGap={30}/>
        <YAxis {...AX} width={46} tickFormatter={tickFmt||(v=>v.toFixed(2))}/>
        {spot&&<ReferenceLine x={spot} stroke={T.muted} strokeDasharray="4 3" label={{value:"ATM",fill:T.muted,fontSize:9,position:"top"}}/>}
        <Tooltip {...TTStyle} formatter={(v,n)=>[Number(v).toFixed(5),n]}/>
        <Line type="monotone" dataKey="call" stroke={T.green} strokeWidth={1.5} dot={false} name="Call"/>
        <Line type="monotone" dataKey="put"  stroke={T.b}     strokeWidth={1.5} dot={false} name="Put" strokeDasharray="5 3"/>
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── PositionDeltaChart ─────────────────────────────────────────────────────────
function PositionDeltaChart({ positions, netDelta, stockColor, height=220 }) {
  const data = (positions||[]).map(p=>({ label: p.identifier?.trim()||"?", delta: p.position_delta }))
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{top:8,right:12,left:0,bottom:30}}>
        <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false}/>
        <XAxis dataKey="label" {...AX} interval={0} angle={-16} textAnchor="end" tick={{...AX.tick,fontSize:9}}/>
        <YAxis {...AX} width={50} label={{value:"Qty × per-unit Δ",angle:-90,position:"insideLeft",fill:T.muted,fontSize:9}}/>
        <ReferenceLine y={0} stroke={T.axis}/>
        {netDelta!=null&&<ReferenceLine y={netDelta} stroke={stockColor} strokeDasharray="6 4"
          label={{value:`Net Δ = ${Number(netDelta).toFixed(2)}`,fill:stockColor,fontSize:9,position:"insideTopRight"}}/>}
        <Tooltip {...TTStyle} formatter={v=>[fmt4(v),"Position Δ"]}/>
        <Bar dataKey="delta" radius={[3,3,0,0]}>
          {data.map((e,i)=><Cell key={i} fill={e.delta>=0?T.green:T.b} fillOpacity={0.8}/>)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── CompositionRow + NetRow ─────────────────────────────────────────────────────
function CompositionRow({ pos, color }) {
  const m = pos.identifier?.match(/^(\d+)d\s+(.*?)\s+(call|put)$/i)||[]
  const tc = (m[3]||"").toUpperCase()==="CALL" ? T.green : T.red
  return (
    <tr className="border-b hover:bg-white/1.5" style={{borderColor:T.divider}}>
      <td className="py-2.5 px-3 text-[11px] font-mono font-semibold" style={{color}}>{pos.identifier}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono" style={{color:"#c0c0d0"}}>{m[1]?`${m[1]}d`:"—"}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono" style={{color:T.muted}}>{m[2]||"—"}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono font-bold" style={{color:tc}}>{(m[3]||"").toUpperCase()||"—"}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums" style={{color:pos.quantity>0?T.green:T.red}}>{pos.quantity>0?`+${pos.quantity}`:pos.quantity}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.yellow}}>{fmt2(pos.bsm_price)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:pos.position_cost>=0?T.green:T.red}}>{fmtSgn(pos.position_cost)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.a}}>{fmt4(pos.position_delta)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.accent}}>{fmt4(pos.position_gamma)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono tabular-nums text-right" style={{color:T.b}}>{fmt4(pos.position_vega)}</td>
    </tr>
  )
}

function NetRow({ agg, label, color }) {
  return (
    <tr style={{background:color+"0a",borderTop:`1px solid ${color}25`}}>
      <td className="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider" style={{color}} colSpan={6}>{label}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:agg.total_cost>=0?T.green:T.red}}>{fmtSgn(agg.total_cost)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.a}}>{fmt4(agg.net_delta)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.accent}}>{fmt4(agg.net_gamma)}</td>
      <td className="py-2.5 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.b}}>{fmt4(agg.net_vega)}</td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function PartC() {
  const { partBData, partAData, setPartCData } = usePortfolioStore()

  // quantities keyed "L:idx" or "I:idx"
  const [quantities, setQuantities] = useState({})

  // turnover overrides
  const [trL, setTrL] = useState("")
  const [trI, setTrI] = useState("")

  // greek curve controls
  const [activeGreek, setActiveGreek] = useState("delta")
  const [curveMat,    setCurveMat]    = useState(30)

  // results
  const [resultL, setResultL] = useState(null)
  const [resultI, setResultI] = useState(null)
  const [loading,  setLoading] = useState(false)
  const [error,    setError]   = useState("")

  // ── Source data ────────────────────────────────────────────────────────────
  const bData = partBData?.data || {}
  const aData = partAData?.data || {}

  const lStock = bData.liquid   || {}
  const iStock = bData.illiquid || {}

  const lTick = lStock.ticker || "LIQUID"
  const iTick = iStock.ticker || "ILLIQUID"
  const lSpot = Number(lStock.spot) || 0
  const iSpot = Number(iStock.spot) || 0
  const lVolDec = (Number(lStock.hist_vol_pct) || 0) / 100
  const iVolDec = (Number(iStock.hist_vol_pct) || 0) / 100

  const aTrL = aData.liquid?.liquidity?.summary_stats?.turnover_ratio_mean
  const aTrI = aData.illiquid?.liquidity?.summary_stats?.turnover_ratio_mean
  const effTrL = trL !== "" ? parseFloat(trL) : (aTrL ?? 1.0)
  const effTrI = trI !== "" ? parseFloat(trI) : (aTrI ?? 1.0)

  function dedup(rows) {
    const seen = new Set()
    return (rows||[]).filter(r=>{ const k=`${r.option_type}|${r.target_maturity_days}|${r.strike}`; if(seen.has(k))return false; seen.add(k); return true })
  }
  const lRows = useMemo(()=>dedup(lStock.pricing_table),[lStock])
  const iRows = useMemo(()=>dedup(iStock.pricing_table),[iStock])

  // Active legs
  const activeL = useMemo(()=>lRows.map((r,i)=>({row:{...r,_ticker:lTick},qty:quantities[`L:${i}`]||0,key:`L:${i}`})).filter(x=>x.qty!==0),[lRows,quantities,lTick])
  const activeI = useMemo(()=>iRows.map((r,i)=>({row:{...r,_ticker:iTick},qty:quantities[`I:${i}`]||0,key:`I:${i}`})).filter(x=>x.qty!==0),[iRows,quantities,iTick])
  const totalLegs = activeL.length + activeI.length

  const setQty = useCallback((key,val)=>setQuantities(prev=>({...prev,[key]:val})),[])
  const clearAll = ()=>{
    setQuantities({})
    setResultL(null)
    setResultI(null)
    setError("")
    setPartCData(null)
  }

  // ── Greek curves (client-side, from partBData sigma already in store) ──────
  const lCurves = useMemo(()=>buildGreeksCurve(lSpot,lVolDec,0.068,curveMat),[lSpot,lVolDec,curveMat])
  const iCurves = useMemo(()=>buildGreeksCurve(iSpot,iVolDec,0.068,curveMat),[iSpot,iVolDec,curveMat])
  const lGreekData = useMemo(()=>mergeCurves(lCurves.call,lCurves.put,activeGreek),[lCurves,activeGreek])
  const iGreekData = useMemo(()=>mergeCurves(iCurves.call,iCurves.put,activeGreek),[iCurves,activeGreek])

  // ── Run ────────────────────────────────────────────────────────────────────
  const canRun = totalLegs > 0

  const mkPayload = (ticker,spot,histVolPct,legs,effTr) => ({
    ticker, spot, current_vol_pct: histVolPct,
    turnover_ratio: Number.isFinite(effTr)?effTr:1.0,
    positions: legs.map(({row,qty})=>({
      identifier: `${row.target_maturity_days}d ${row.moneyness_label||""} ${row.option_type}`.trim(),
      quantity:   qty,
      bsm_price:  Number(row.bsm_price_hist_vol)||0,
      delta:      Number(row.delta)||0,
      gamma:      Number(row.gamma)||0,
      vega:       Number(row.vega) ||0,
      theta:      Number(row.theta)||0,
    })),
  })

  const runAnalysis = async () => {
    if (!canRun) return
    setLoading(true); setError(""); setResultL(null); setResultI(null)
    try {
      const promises = []
      if (activeL.length>0) promises.push(callPortfolioAPI(mkPayload(lTick,lSpot,lStock.hist_vol_pct||0,activeL,effTrL)))
      else promises.push(Promise.resolve(null))
      if (activeI.length>0) promises.push(callPortfolioAPI(mkPayload(iTick,iSpot,iStock.hist_vol_pct||0,activeI,effTrI)))
      else promises.push(Promise.resolve(null))
      const [rL,rI] = await Promise.all(promises)
      if (rL?.status==="success") setResultL(rL.data)
      if (rI?.status==="success") setResultI(rI.data)
      setPartCData({
        liquidTicker: lTick,
        illiquidTicker: iTick,
        activeLegs: {
          liquid: activeL.map(({ row, qty }) => ({
            ticker: row._ticker,
            option_type: row.option_type,
            moneyness_label: row.moneyness_label,
            target_maturity_days: row.target_maturity_days,
            strike: row.strike,
            quantity: qty,
          })),
          illiquid: activeI.map(({ row, qty }) => ({
            ticker: row._ticker,
            option_type: row.option_type,
            moneyness_label: row.moneyness_label,
            target_maturity_days: row.target_maturity_days,
            strike: row.strike,
            quantity: qty,
          })),
        },
        analysis: {
          liquid: rL?.data || null,
          illiquid: rI?.data || null,
        },
        updatedAt: new Date().toISOString(),
      })
      if (!rL?.data && !rI?.data) setError("No results returned from server")
    } catch(e) { setError(e.message||"Analysis failed") }
    finally { setLoading(false) }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const aggL  = resultL?.analysis?.portfolio?.aggregate || {}
  const aggI  = resultI?.analysis?.portfolio?.aggregate || {}
  const hedgL = resultL?.analysis?.hedging || {}
  const hedgI = resultI?.analysis?.hedging || {}
  const simL  = resultL?.analysis?.simulations || {}
  const simI  = resultI?.analysis?.simulations || {}

  const combined = {
    net_delta:  (aggL.net_delta ||0)+(aggI.net_delta ||0),
    net_gamma:  (aggL.net_gamma ||0)+(aggI.net_gamma ||0),
    net_vega:   (aggL.net_vega  ||0)+(aggI.net_vega  ||0),
    net_theta:  (aggL.net_theta ||0)+(aggI.net_theta ||0),
    total_cost: (aggL.total_cost||0)+(aggI.total_cost||0),
  }

  const pnlChart = useMemo(()=>{
    const rows=[]
    ;(simL.price_shocks||[]).forEach(s=>rows.push({label:`${lTick} ${s.shock_label}`,pnl:s.simulated_pnl_inr,stock:"L"}))
    ;(simI.price_shocks||[]).forEach(s=>rows.push({label:`${iTick} ${s.shock_label}`,pnl:s.simulated_pnl_inr,stock:"I"}))
    ;(simL.volatility_shocks||[]).forEach(s=>rows.push({label:`${lTick} Vol${s.shock_value_pct>0?"+":""}${s.shock_value_pct}%`,pnl:s.simulated_pnl_inr,stock:"L"}))
    ;(simI.volatility_shocks||[]).forEach(s=>rows.push({label:`${iTick} Vol${s.shock_value_pct>0?"+":""}${s.shock_value_pct}%`,pnl:s.simulated_pnl_inr,stock:"I"}))
    return rows
  },[simL,simI,lTick,iTick])

  const radarData = useMemo(()=>{
    if (!resultL&&!resultI) return []
    const vals=[
      {greek:"Δ Delta", L:Math.abs(aggL.net_delta||0),       I:Math.abs(aggI.net_delta||0)},
      {greek:"Γ Gamma", L:Math.abs((aggL.net_gamma||0)*1000),I:Math.abs((aggI.net_gamma||0)*1000)},
      {greek:"ν Vega",  L:Math.abs(aggL.net_vega ||0),       I:Math.abs(aggI.net_vega ||0)},
      {greek:"Θ Theta", L:Math.abs(aggL.net_theta||0),       I:Math.abs(aggI.net_theta||0)},
    ]
    const mx=Math.max(...vals.flatMap(v=>[v.L,v.I]),1)
    return vals.map(v=>({greek:v.greek,liquid:+(v.L/mx*100).toFixed(1),illiquid:+(v.I/mx*100).toFixed(1)}))
  },[resultL,resultI,aggL,aggI])

  const greekMeta = {
    delta: { label:"Delta (Δ)",          tickFmt:v=>v.toFixed(2)     },
    gamma: { label:"Gamma (Γ)",          tickFmt:v=>v.toExponential(1) },
    vega:  { label:"Vega per 1% σ (ν)", tickFmt:v=>v.toFixed(2)     },
    theta: { label:"Theta per day (Θ)", tickFmt:v=>v.toFixed(3)     },
  }

  if (!partBData) return (
    <div className="flex flex-col items-center justify-center min-h-75 gap-3" style={{color:T.muted}}>
      <span className="text-4xl">SYS</span>
      <p className="text-[13px] font-mono">Run Part B first to load option chain data</p>
    </div>
  )

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8">

      {/* ══════════════════════════════════════════════════════════
          §0  BSM Greeks vs Strike — computed client-side
      ══════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader label="BSM Greeks vs Strike Price" sub={`${curveMat}d maturity · σ from Part B · computed client-side`}/>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1 p-1 rounded" style={{background:T.bg,border:`1px solid ${T.divider}`}}>
            {Object.entries(greekMeta).map(([k,{label}])=>(
              <button key={k} onClick={()=>setActiveGreek(k)}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all"
                style={{background:activeGreek===k?T.accent+"20":"transparent",color:activeGreek===k?T.accent:T.muted,border:`1px solid ${activeGreek===k?T.accent+"40":"transparent"}`}}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 rounded" style={{background:T.bg,border:`1px solid ${T.divider}`}}>
            {[30,60].map(m=>(
              <button key={m} onClick={()=>setCurveMat(m)}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all"
                style={{background:curveMat===m?T.yellow+"15":"transparent",color:curveMat===m?T.yellow:T.muted,border:`1px solid ${curveMat===m?T.yellow+"35":"transparent"}`}}>
                {m}d
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono ml-1" style={{color:T.muted}}>
            <span><span style={{color:T.green}}>—— </span>Call</span>
            <span><span style={{color:T.b}}>╌╌ </span>Put</span>
          </div>
        </div>

        {/* Main 2-column chart */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-3">
          <ChartCard title={`${lTick}`} badge={`${curveMat}d · Liquid · ${greekMeta[activeGreek].label}`} height={200}>
            <GreekCurveChart data={lGreekData} spot={lSpot} tickFmt={greekMeta[activeGreek].tickFmt}/>
          </ChartCard>
          <ChartCard title={`${iTick}`} badge={`${curveMat}d · Illiquid · ${greekMeta[activeGreek].label}`} height={200}>
            <GreekCurveChart data={iGreekData} spot={iSpot} tickFmt={greekMeta[activeGreek].tickFmt}/>
          </ChartCard>
        </div>

        {/* Thumbnail strip for other 3 Greeks */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(greekMeta).filter(([k])=>k!==activeGreek).map(([k,{label,tickFmt}])=>{
            const ld=mergeCurves(lCurves.call,lCurves.put,k)
            return (
              <button key={k} onClick={()=>setActiveGreek(k)}
                className="rounded-lg overflow-hidden text-left hover:ring-1 hover:ring-violet-400/30 transition-all"
                style={{background:T.surface,border:`1px solid ${T.divider}`}}>
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest" style={{color:T.muted,borderBottom:`1px solid ${T.divider}`,background:T.surfaceHi}}>{label}</div>
                <div style={{height:88,pointerEvents:"none"}}>
                  <ResponsiveContainer width="100%" height={88}>
                    <LineChart data={ld} margin={{top:4,right:4,left:0,bottom:4}}>
                      <Line type="monotone" dataKey="call" stroke={T.green} strokeWidth={1.2} dot={false}/>
                      <Line type="monotone" dataKey="put"  stroke={T.b}     strokeWidth={1.2} dot={false} strokeDasharray="4 3"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          §1  Portfolio Builder
      ══════════════════════════════════════════════════════════ */}
      <section>
        <SectionHeader label="Portfolio Builder" sub="Cross-stock · both liquid & illiquid legs in one portfolio"/>

        {/* Context tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
          <MetricTile label={`${lTick} Spot`}     value={fmtINR(lSpot)}                      color={T.a}/>
          <MetricTile label={`${lTick} Hist Vol`}  value={fmtPct(lStock.hist_vol_pct)}        color={T.accent}/>
          <MetricTile label={`${iTick} Spot`}     value={fmtINR(iSpot)}                      color={T.b}/>
          <MetricTile label={`${iTick} Hist Vol`}  value={fmtPct(iStock.hist_vol_pct)}        color={T.accent}/>
          {/* Turnover overrides */}
          {[
            {label:`${lTick} Turnover`,val:trL,setter:setTrL,hint:aTrL},
            {label:`${iTick} Turnover`,val:trI,setter:setTrI,hint:aTrI},
          ].map(({label,val,setter,hint})=>(
            <div key={label} className="rounded-lg p-3 flex flex-col gap-1" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
              <span className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{color:T.muted}}>{label}</span>
              <input type="number" step="0.01" min="0" value={val} onChange={e=>setter(e.target.value)}
                placeholder={hint!=null?hint.toFixed(4):"1.0000"}
                className="text-[12px] font-mono rounded outline-none px-2 py-1 w-full"
                style={{background:T.bg,color:T.yellow,border:`1px solid ${T.divider}`}}/>
              <span className="text-[9px] font-mono" style={{color:T.muted}}>Part A: {hint?.toFixed(4)??"—"}</span>
            </div>
          ))}
        </div>

        {/* Unified legs table */}
        <div className="rounded-lg overflow-hidden" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
          <div className="flex items-center justify-between px-4 py-3" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#d0d0e0"}}>Available Option Legs — Both Stocks</span>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono" style={{color:T.muted}}>+qty = Long &nbsp;|&nbsp; −qty = Short</span>
              <button onClick={clearAll} className="text-[10px] font-mono px-2.5 py-1 rounded hover:bg-white/10" style={{color:T.red,border:`1px solid ${T.red}30`}}>Clear All</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr style={{borderBottom:`1px solid ${T.divider}`}}>
                  {["Stock","Type","Moneyness","Mat.","Strike","BSM Price","Delta","Gamma","Vega","Quantity"].map(h=>(
                    <th key={h} className="py-2 px-3 text-[9px] font-bold uppercase tracking-[0.14em]" style={{color:T.muted}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lRows.length>0&&(<>
                  <tr style={{background:T.aDim}}>
                    <td colSpan={10} className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-widest" style={{color:T.a}}>● {lTick} — Liquid</td>
                  </tr>
                  {lRows.map((row,idx)=>(
                    <LegRow key={`L:${idx}`} row={{...row,_ticker:lTick}} qty={quantities[`L:${idx}`]||0}
                      onQtyChange={v=>setQty(`L:${idx}`,v)} stockColor={T.a}/>
                  ))}
                </>)}
                {iRows.length>0&&(<>
                  <tr style={{background:T.bDim}}>
                    <td colSpan={10} className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-widest" style={{color:T.b}}>● {iTick} — Illiquid</td>
                  </tr>
                  {iRows.map((row,idx)=>(
                    <LegRow key={`I:${idx}`} row={{...row,_ticker:iTick}} qty={quantities[`I:${idx}`]||0}
                      onQtyChange={v=>setQty(`I:${idx}`,v)} stockColor={T.b}/>
                  ))}
                </>)}
              </tbody>
            </table>
          </div>
        </div>

        {/* Preview strip */}
        {totalLegs>0&&(
          <div className="mt-3 rounded-lg p-4" style={{background:T.yellowDim,border:`1px solid ${T.yellow}20`}}>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2" style={{color:T.yellow}}>
              Portfolio Preview — {totalLegs} Active Leg{totalLegs!==1?"s":""}
            </p>
            <div className="flex flex-wrap gap-2">
              {[...activeL,...activeI].map(({row,qty},i)=>(
                <span key={i} className="text-[10px] font-mono px-2.5 py-1 rounded"
                  style={{background:qty>0?T.greenDim:T.redDim,color:qty>0?T.green:T.red,border:`1px solid ${qty>0?T.green:T.red}30`}}>
                  {qty>0?"L":"S"}{Math.abs(qty)} × {row._ticker} {row.target_maturity_days}d {row.option_type?.toUpperCase()}{row.strike?` @${fmt2(row.strike)}`:""}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center gap-3 mt-4">
          <button onClick={runAnalysis} disabled={!canRun||loading}
            className="h-10 px-8 text-[11px] font-bold tracking-widest uppercase rounded transition-all duration-200"
            style={{background:canRun&&!loading?T.yellow:"#ffffff10",color:canRun&&!loading?"#000":T.muted,boxShadow:canRun&&!loading?`0 0 20px ${T.yellow}25`:"none",cursor:!canRun||loading?"not-allowed":"pointer"}}>
            {loading?"Computing…":"Run Analysis →"}
          </button>
          {!canRun&&<span className="text-[10px] font-mono" style={{color:T.muted}}>Add at least one leg with non-zero quantity</span>}
        </div>
        {error&&<p className="mt-3 text-[11px] font-mono px-4 py-2.5 rounded" style={{color:T.red,background:T.redDim,border:`1px solid ${T.red}30`}}>Error: {error}</p>}
      </section>

      {/* ══════════════════════════════════════════════════════════
          RESULTS
      ══════════════════════════════════════════════════════════ */}
      {(resultL||resultI)&&(<>

        {/* §2  Portfolio Composition */}
        <section>
          <SectionHeader label="Portfolio Composition" sub="Position-level Greeks breakdown"/>

          <div className="rounded-lg overflow-hidden mb-4" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr style={{borderBottom:`1px solid ${T.divider}`,background:T.surfaceHi}}>
                    {["Leg","Mat.","Moneyness","Type","Qty","Price (₹)","Cost (₹)","Pos. Δ","Pos. Γ","Pos. ν"].map(h=>(
                      <th key={h} className="py-2.5 px-3 text-[9px] font-bold uppercase tracking-[0.14em]" style={{color:T.muted}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultL&&(<>
                    <tr style={{background:T.aDim}}><td colSpan={10} className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-widest" style={{color:T.a}}>● {lTick}</td></tr>
                    {(resultL.analysis?.portfolio?.positions||[]).map((p,i)=><CompositionRow key={i} pos={p} color={T.a}/>)}
                    <NetRow agg={aggL} label={`NET (${lTick})`} color={T.a}/>
                  </>)}
                  {resultI&&(<>
                    <tr style={{background:T.bDim}}><td colSpan={10} className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-widest" style={{color:T.b}}>● {iTick}</td></tr>
                    {(resultI.analysis?.portfolio?.positions||[]).map((p,i)=><CompositionRow key={i} pos={p} color={T.b}/>)}
                    <NetRow agg={aggI} label={`NET (${iTick})`} color={T.b}/>
                  </>)}
                  {resultL&&resultI&&(
                    <tr style={{background:"#a78bfa0a",borderTop:`2px solid ${T.accent}30`}}>
                      <td className="py-3 px-3 text-[11px] font-bold uppercase tracking-wider" style={{color:T.accent}} colSpan={6}>Combined Net</td>
                      <td className="py-3 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:combined.total_cost>=0?T.green:T.red}}>{fmtSgn(combined.total_cost)}</td>
                      <td className="py-3 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.a}}>{fmt4(combined.net_delta)}</td>
                      <td className="py-3 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.accent}}>{fmt4(combined.net_gamma)}</td>
                      <td className="py-3 px-3 text-[11px] font-mono font-bold tabular-nums text-right" style={{color:T.b}}>{fmt4(combined.net_vega)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Position-delta bar charts — matching reference image §C */}
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3 mt-1" style={{color:T.accent}}>
            Part C — Portfolio Position Deltas (Before Hedge)
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {resultL&&(
              <ChartCard title={`${lTick} — Position Deltas`} badge="Liquid" height={240}>
                <PositionDeltaChart positions={resultL.analysis?.portfolio?.positions||[]} netDelta={aggL.net_delta} stockColor={T.a} height={220}/>
              </ChartCard>
            )}
            {resultI&&(
              <ChartCard title={`${iTick} — Position Deltas`} badge="Illiquid" height={240}>
                <PositionDeltaChart positions={resultI.analysis?.portfolio?.positions||[]} netDelta={aggI.net_delta} stockColor={T.b} height={220}/>
              </ChartCard>
            )}
          </div>
        </section>

        {/* §3  Net Greeks */}
        <section>
          <SectionHeader label="Net Portfolio Greeks" sub="Aggregate risk sensitivities"/>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricTile label="Net Δ (Combined)" value={fmt4(combined.net_delta)} color={T.a}      glow/>
            <MetricTile label="Net Γ (Combined)" value={fmt4(combined.net_gamma)} color={T.accent} glow/>
            <MetricTile label="Net ν (Combined)" value={fmt4(combined.net_vega)}  color={T.b}      glow/>
            <MetricTile label="Net Θ (Combined)" value={fmt4(combined.net_theta)} color={T.muted}/>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="Greeks Exposure — Liquid vs Illiquid" badge="Radar" height={250}>
              <ResponsiveContainer width="100%" height={230}>
                <RadarChart data={radarData} margin={{top:4,right:24,bottom:4,left:24}}>
                  <PolarGrid stroke={T.grid}/>
                  <PolarAngleAxis dataKey="greek" tick={{fill:T.muted,fontSize:11,fontFamily:"'DM Mono',monospace"}}/>
                  <PolarRadiusAxis angle={90} domain={[0,100]} tick={false} axisLine={false}/>
                  <Radar name={lTick} dataKey="liquid"   stroke={T.a} fill={T.a} fillOpacity={0.15} strokeWidth={1.5}/>
                  <Radar name={iTick} dataKey="illiquid" stroke={T.b} fill={T.b} fillOpacity={0.15} strokeWidth={1.5}/>
                  <Tooltip {...TTStyle}/>
                </RadarChart>
              </ResponsiveContainer>
            </ChartCard>
            {/* Greeks comparison table */}
            <div className="rounded-lg overflow-hidden" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
              <div className="px-4 py-3" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#d0d0e0"}}>Greeks Comparison</span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{borderBottom:`1px solid ${T.divider}`}}>
                    {["Greek",lTick,iTick,"Combined"].map(h=>(
                      <th key={h} className="py-2.5 px-4 text-[9px] font-bold uppercase tracking-[0.14em] text-left" style={{color:T.muted}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {label:"Net Delta", lv:aggL.net_delta, iv:aggI.net_delta, cv:combined.net_delta},
                    {label:"Net Gamma", lv:aggL.net_gamma, iv:aggI.net_gamma, cv:combined.net_gamma},
                    {label:"Net Vega",  lv:aggL.net_vega,  iv:aggI.net_vega,  cv:combined.net_vega},
                    {label:"Net Theta", lv:aggL.net_theta, iv:aggI.net_theta, cv:combined.net_theta},
                    {label:"Total Cost",lv:aggL.total_cost,iv:aggI.total_cost,cv:combined.total_cost},
                  ].map(r=>(
                    <tr key={r.label} className="border-b hover:bg-white/1.5" style={{borderColor:T.divider}}>
                      <td className="py-2.5 px-4 text-[12px]" style={{color:T.muted}}>{r.label}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color:T.a}}>{fmt4(r.lv)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color:T.b}}>{fmt4(r.iv)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono font-bold tabular-nums" style={{color:T.accent}}>{fmt4(r.cv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* §4  Delta Hedging */}
        <section>
          <SectionHeader label="Delta Hedging" sub="Liquidity-adjusted per stock · before & after"/>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {[
              {res:resultL,agg:aggL,hedg:hedgL,ticker:lTick,spot:lSpot,effTr:effTrL,color:T.a},
              {res:resultI,agg:aggI,hedg:hedgI,ticker:iTick,spot:iSpot,effTr:effTrI,color:T.b},
            ].filter(x=>x.res).map(({hedg,ticker,effTr,color})=>(
              <div key={ticker} className="rounded-lg overflow-hidden" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
                <div className="flex items-center gap-2 px-4 py-3" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
                  <span className="w-2 h-2 rounded-full" style={{background:color}}/>
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#d0d0e0"}}>{ticker} — Hedge Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
                  <MetricTile label="Net Portfolio Δ"  value={fmt4(hedg.net_portfolio_delta)}       color={color}/>
                  <MetricTile label="Raw Shares"       value={fmt2(hedg.shares_to_hedge_raw)}        color={hedg.shares_to_hedge_raw>=0?T.green:T.red}
                    sub={hedg.shares_to_hedge_raw>=0?"Buy underlying":"Sell underlying"}/>
                  <MetricTile label="Liq. Adj. Factor" value={fmt4(hedg.liquidity_adjustment_factor)} color={hedg.liquidity_adjustment_factor>=1?T.green:T.yellow} glow
                    sub={hedg.liquidity_adjustment_factor>=1?"Full hedge":"Scaled down"}/>
                  <MetricTile label="Adj. Shares"      value={fmt2(hedg.shares_to_hedge_adjusted)}  color={T.accent} glow/>
                  <div className="col-span-2">
                    <MetricTile label="Hedge Cost (Adj.)" value={fmtINR(hedg.hedge_cost_adjusted_inr)} sub={`Raw: ${fmtINR(hedg.hedge_cost_raw_inr)}`} color={T.yellow}/>
                  </div>
                </div>
                <div className="px-4 pb-4">
                  <div className="rounded p-3 text-[11px] leading-relaxed" style={{background:T.accentDim,border:`1px solid ${T.accent}20`,color:"#c0c0d0"}}>
                    {hedg.interpretation||"—"}
                    {hedg.liquidity_adjustment_factor<1&&(
                      <p className="mt-1.5 text-[10px]" style={{color:T.yellow}}>
                        Warning: Turnover ratio {effTr?.toFixed(4)} means residual unhedged delta is accepted to avoid market impact.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Before/After summary */}
          {resultL&&resultI&&(
            <div className="mt-4 rounded-lg overflow-hidden" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
              <div className="px-4 py-3" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#d0d0e0"}}>Hedge Summary — Before vs After</span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{borderBottom:`1px solid ${T.divider}`}}>
                    {["Stock","Portfolio Δ","Shares (Raw)","Liq. Factor","Shares (Adj.)","Hedge Cost"].map(h=>(
                      <th key={h} className="py-2.5 px-4 text-[9px] font-bold uppercase tracking-[0.14em] text-left" style={{color:T.muted}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {ticker:lTick,hedg:hedgL,color:T.a},
                    {ticker:iTick,hedg:hedgI,color:T.b},
                  ].map(({ticker,hedg,color})=>(
                    <tr key={ticker} className="border-b hover:bg-white/1.5" style={{borderColor:T.divider}}>
                      <td className="py-2.5 px-4"><StockBadge ticker={ticker} color={color}/></td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color}}>{fmt4(hedg.net_portfolio_delta)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color:hedg.shares_to_hedge_raw>=0?T.green:T.red}}>{fmt2(hedg.shares_to_hedge_raw)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color:hedg.liquidity_adjustment_factor>=1?T.green:T.yellow}}>{fmt4(hedg.liquidity_adjustment_factor)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono font-bold tabular-nums" style={{color:T.accent}}>{fmt2(hedg.shares_to_hedge_adjusted)}</td>
                      <td className="py-2.5 px-4 text-[12px] font-mono tabular-nums" style={{color:T.yellow}}>{fmtINR(hedg.hedge_cost_adjusted_inr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* §5  PnL Stress */}
        <section>
          <SectionHeader label="PnL Stress Simulation" sub="Taylor expansion: Δ–Γ price shocks · Vega vol shocks"/>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            {[
              {res:resultL,sim:simL,ticker:lTick,color:T.a},
              {res:resultI,sim:simI,ticker:iTick,color:T.b},
            ].filter(x=>x.res).map(({sim,ticker,color})=>(
              <div key={ticker} className="rounded-lg overflow-hidden" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
                <div className="flex items-center gap-2 px-4 py-3" style={{background:T.surfaceHi,borderBottom:`1px solid ${T.divider}`}}>
                  <span className="w-2 h-2 rounded-full" style={{background:color}}/>
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#d0d0e0"}}>{ticker}</span>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{borderBottom:`1px solid ${T.divider}`}}>
                      {["Scenario","Move","PnL (₹)"].map(h=>(
                        <th key={h} className="py-2 px-4 text-[9px] font-bold uppercase tracking-[0.14em] text-left" style={{color:T.muted}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(sim.price_shocks||[]).map((s,i)=>(
                      <tr key={i} className="border-b hover:bg-white/1.5" style={{borderColor:T.divider}}>
                        <td className="py-2 px-4 text-[11px] font-mono font-bold" style={{color:"#c0c0d0"}}>{s.shock_label}</td>
                        <td className="py-2 px-4 text-[11px] font-mono tabular-nums" style={{color:s.shock_value_pct>=0?T.green:T.red}}>{s.shock_value_pct>0?"+":""}{s.shock_value_pct}% price</td>
                        <td className="py-2 px-4 text-[11px] font-mono font-bold tabular-nums" style={{color:s.simulated_pnl_inr>=0?T.green:T.red}}>{fmtSgn(s.simulated_pnl_inr)}</td>
                      </tr>
                    ))}
                    {(sim.volatility_shocks||[]).map((s,i)=>(
                      <tr key={i} className="border-b hover:bg-white/1.5" style={{borderColor:T.divider}}>
                        <td className="py-2 px-4 text-[11px] font-mono font-bold" style={{color:"#c0c0d0"}}>{s.shock_label}</td>
                        <td className="py-2 px-4 text-[11px] font-mono tabular-nums" style={{color:s.shock_value_pct>=0?T.green:T.red}}>{s.shock_value_pct>0?"+":""}{s.shock_value_pct}% vol</td>
                        <td className="py-2 px-4 text-[11px] font-mono font-bold tabular-nums" style={{color:s.simulated_pnl_inr>=0?T.green:T.red}}>{fmtSgn(s.simulated_pnl_inr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <ChartCard title="PnL Across All Scenarios — Both Stocks" badge="Taylor Expansion" height={260}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pnlChart} margin={{top:4,right:10,left:10,bottom:46}}>
                <CartesianGrid strokeDasharray="2 5" stroke={T.grid} vertical={false}/>
                <XAxis dataKey="label" {...AX} interval={0} angle={-28} textAnchor="end" tick={{...AX.tick,fontSize:8}}/>
                <YAxis {...AX} tickFormatter={v=>fmtSgn(v)} width={72}/>
                <ReferenceLine y={0} stroke={T.axis} strokeDasharray="3 3"/>
                <Tooltip {...TTStyle} formatter={v=>[fmtSgn(v)+" INR","PnL"]}/>
                <Bar dataKey="pnl" radius={[3,3,0,0]}>
                  {pnlChart.map((e,i)=>(
                    <Cell key={i} fill={e.pnl>=0?T.green:T.red} fillOpacity={e.stock==="L"?0.9:0.55}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        {/* §6  Interpretation */}
        <section>
          <SectionHeader label="Part C Interpretation" sub="Academic summary"/>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            <InsightCard icon="GS" title="Greeks & Portfolio Sensitivity">
              <p>Combined net Delta <strong style={{color:T.a}}>{fmt4(combined.net_delta)}</strong>: portfolio gains/loses ≈ ₹{fmt2(Math.abs(combined.net_delta))} per ₹1 move in the aggregate underlying.</p>
              <p>Net Gamma <strong style={{color:T.accent}}>{fmt4(combined.net_gamma)}</strong>
                {(combined.net_gamma||0)>0?" — long gamma: large moves in either direction profitable.":" — short gamma: low-volatility environments favour this book."}</p>
              <p>Net Vega <strong style={{color:T.b}}>{fmt4(combined.net_vega)}</strong>: every 1 pp rise in IV shifts portfolio value by ≈ ₹{fmt2(Math.abs(combined.net_vega))}.</p>
            </InsightCard>

            <InsightCard icon="LH" title="Liquidity & Hedging Effectiveness">
              <p><strong style={{color:T.a}}>{lTick}</strong> turnover: <strong style={{color:T.yellow}}>{effTrL?.toFixed(4)}</strong>
                {hedgL.liquidity_adjustment_factor>=1?" — full hedge executable without material slippage."
                  :` — hedge scaled to ${((hedgL.liquidity_adjustment_factor||0)*100).toFixed(1)}% to cap market impact.`}</p>
              <p><strong style={{color:T.b}}>{iTick}</strong> turnover: <strong style={{color:T.yellow}}>{effTrI?.toFixed(4)}</strong>
                {hedgI.liquidity_adjustment_factor>=1?" — full hedge executable without material slippage."
                  :` — hedge scaled to ${((hedgI.liquidity_adjustment_factor||0)*100).toFixed(1)}% to cap market impact.`}</p>
              <p>Illiquid stocks face amplified friction during stress — the liquidity-hedging paradox standard BSM models do not capture.</p>
            </InsightCard>

            <div className="xl:col-span-2 rounded-lg p-5 flex flex-col gap-3" style={{background:T.surface,border:`1px solid ${T.divider}`}}>
              <div className="flex items-center gap-2">
                <span className="text-sm opacity-80">SCN</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{color:T.accent}}>PnL Scenario Comparison</span>
              </div>
              <div className="text-[12px] leading-relaxed space-y-2" style={{color:"#c0c0d0"}}>
                {[
                  {res:resultL,sim:simL,agg:aggL,ticker:lTick},
                  {res:resultI,sim:simI,agg:aggI,ticker:iTick},
                ].filter(x=>x.res).map(({sim,agg,ticker})=>{
                  const ps=sim.price_shocks||[], vs=sim.volatility_shocks||[]
                  const up2=ps.find(s=>s.shock_value_pct===2)?.simulated_pnl_inr
                  const dn2=ps.find(s=>s.shock_value_pct===-2)?.simulated_pnl_inr
                  const vU=vs.find(s=>s.shock_value_pct===20)?.simulated_pnl_inr
                  const vD=vs.find(s=>s.shock_value_pct===-20)?.simulated_pnl_inr
                  const sym=up2!=null&&dn2!=null&&Math.abs(Math.abs(up2)-Math.abs(dn2))/Math.max(Math.abs(up2),Math.abs(dn2),1)<0.1
                  return (
                    <p key={ticker}>
                      <strong>{ticker}</strong>: ±2% price → <strong style={{color:up2>=0?T.green:T.red}}>{fmtSgn(up2)}</strong> / <strong style={{color:dn2>=0?T.green:T.red}}>{fmtSgn(dn2)}</strong>
                      {sym?" (symmetric — gamma dominant)":" (asymmetric — delta bias)"}. ±20% vol → <strong style={{color:vU>=0?T.green:T.red}}>{fmtSgn(vU)}</strong> / <strong style={{color:vD>=0?T.green:T.red}}>{fmtSgn(vD)}</strong>
                      {(agg.net_vega||0)>0?" (long vega).":" (short vega)."}
                    </p>
                  )
                })}
              </div>
            </div>

          </div>
        </section>

      </>)}
    </div>
  )
}