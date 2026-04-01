// ── Province config ──
const PR_INFO = {
  10:{name:"Newfoundland & Labrador", abbr:"NL"},
  11:{name:"Prince Edward Island",    abbr:"PE"},
  12:{name:"Nova Scotia",             abbr:"NS"},
  13:{name:"New Brunswick",           abbr:"NB"},
  24:{name:"Québec",                  abbr:"QC"},
  35:{name:"Ontario",                 abbr:"ON"},
  46:{name:"Manitoba",                abbr:"MB"},
  47:{name:"Saskatchewan",            abbr:"SK"},
  48:{name:"Alberta",                 abbr:"AB"},
  59:{name:"British Columbia",        abbr:"BC"},
};

// abbr → PR code lookup
const ABBR_TO_PR = {};
Object.entries(PR_INFO).forEach(([k,v]) => ABBR_TO_PR[v.abbr] = +k);

const AGEGRP_MID = {1:2,2:5.5,3:8,4:10.5,5:13,6:16,7:18.5,8:22,9:27,10:32,11:37,12:42,13:47,14:52,15:57,16:62,17:67,18:72,19:77,20:82,21:88};
const NON_IMMIG = new Set([1, 2]); // non-immigrant + pre-1980

function setProgress(pct, msg) {
  document.getElementById("l-fill").style.width = pct + "%";
  if (msg) document.getElementById("l-msg").textContent = msg;
}

// ── Aggregate CSV rows → province stats ──
function aggregatePR(rows) {
  const acc = {};
  Object.keys(PR_INFO).forEach(pr => {
    acc[pr] = {pop:0, incomes:[], immig:0, immig_tot:0, age_num:0, age_den:0, bach:0, bach_tot:0};
  });
  rows.forEach(r => {
    const pr = +(r.pr || r.PR);
    if (!acc[pr]) return;
    const w = +(r.weight || r.WEIGHT) || 1;
    const a = acc[pr];
    a.pop += w;
    const inc = +(r.totinc_at || r.TotInc_AT || 0);
    if (inc > 0 && inc < 88000000) a.incomes.push({v:inc, w});
    const imm = +(r.immcat5 || r.IMMCAT5 || 0);
    if (imm > 0 && imm !== 88) {
      a.immig_tot += w;
      if (!NON_IMMIG.has(imm)) a.immig += w;
    }
    const ag = +(r.agegrp || r.AGEGRP || 88);
    if (ag !== 88 && AGEGRP_MID[ag]) { a.age_num += AGEGRP_MID[ag]*w; a.age_den += w; }
    const hd = +(r.hdgree || r.HDGREE || 0);
    if (hd > 0 && hd !== 88 && hd !== 99) {
      a.bach_tot += w;
      if (hd >= 9) a.bach += w;
    }
  });
  const result = {};
  Object.entries(acc).forEach(([pr, a]) => {
    if (a.pop === 0) return;
    let medInc = 0;
    if (a.incomes.length > 0) {
      a.incomes.sort((x,y) => x.v - y.v);
      const half = a.incomes.reduce((s,x) => s+x.w, 0) / 2;
      let cum = 0;
      for (const {v,w} of a.incomes) { cum += w; if (cum >= half) { medInc = v; break; } }
    }
    result[pr] = {
      pr: +pr, pop: Math.round(a.pop),
      income_med: Math.round(medInc),
      immig_pct:  a.immig_tot > 0 ? +(a.immig/a.immig_tot*100).toFixed(2) : 0,
      median_age: a.age_den  > 0 ? +(a.age_num/a.age_den).toFixed(2) : 0,
      bach_pct:   a.bach_tot > 0 ? +(a.bach/a.bach_tot*100).toFixed(2) : 0,
    };
  });
  return result;
}

// ── State ──
let DATA16 = {}, DATA21 = {};
let topoData = null, currentFrame = 1, expMetric = "pop";
let svg, g, proj, path, W, H;

// ── Map init ──
function initMap() {
  const wrap = document.getElementById("map-sticky");
  W = wrap.clientWidth; H = wrap.clientHeight;
  svg = d3.select("#map-canvas").attr("width",W).attr("height",H);
  const zoomBeh = d3.zoom().scaleExtent([0.6,8]).on("zoom", e => g.attr("transform", e.transform));
  svg.call(zoomBeh);
  g = svg.append("g");
  const features = topojson.feature(topoData, topoData.objects.default);
  proj = d3.geoConicConformal().parallels([49,77]).rotate([96,0]).fitSize([W,H], features);
  path = d3.geoPath().projection(proj);

  g.selectAll(".province")
    .data(features.features).join("path")
    .attr("class","province").attr("d",path).attr("fill","#2a2620")
    .on("mouseover", (e,d) => onHover(e,d))
    .on("mousemove", moveT).on("mouseout", hideT);

  g.selectAll(".prov-label")
    .data(features.features).join("text")
    .attr("class","prov-label")
    .attr("x", d => path.centroid(d)[0])
    .attr("y", d => path.centroid(d)[1])
    .text(d => d.properties["postal-code"] || "");
}

// ── Colour helpers ──
function getValFn(frame) {
  if (frame === 2) return pr => DATA16[pr]?.pop || null;
  if (frame === 3) return pr => {
    const d16=DATA16[pr],d21=DATA21[pr];
    if(!d16||!d21||d16.pop===0) return null;
    return (d21.pop-d16.pop)/d16.pop*100;
  };
  if (frame === 4) return pr => DATA21[pr]?.income_med || null;
  if (frame === 5) return pr => {
    const d16=DATA16[pr],d21=DATA21[pr];
    if(!d16||!d21) return null;
    return d21.bach_pct - d16.bach_pct;
  };
  if (frame === 6) return pr => {
    const d16=DATA16[pr],d21=DATA21[pr];
    if(!d16||!d21) return null;
    return d21.immig_pct - d16.immig_pct;
  };
  if (frame === 7) return pr => {
    const d16=DATA16[pr],d21=DATA21[pr];
    if(!d16||!d21) return null;
    return d21.median_age - d16.median_age;
  };
  return null;
}

const FRAME_CONFIG = {
  2: {interp:d3.interpolateBlues,                            lo:"Fewer people",      hi:"More people",       title:"Population · 2016",                        diverge:false},
  3: {interp:t=>d3.interpolateRgb("#1a1a2e","#2ecc71")(t),  lo:"Slower growth",     hi:"Faster growth",     title:"Population Growth Rate · 2016 → 2021 (%)",  diverge:false},
  4: {interp:d3.interpolateYlOrBr,                          lo:"Lower income",      hi:"Higher income",     title:"Median After-Tax Income · 2021",            diverge:false},
  5: {interp:t=>d3.interpolateRgb("#1a0a14","#f472b6")(t), lo:"Fewer graduates",   hi:"More graduates",    title:"Bachelor's Degree Share Change · 2016 → 2021 (pp)", diverge:false},
  6: {interp:d3.interpolatePurples,                         lo:"Little change",     hi:"Large increase",    title:"Immigrant Share Change · 2016 → 2021 (pp)", diverge:false},
  7: {interp:d3.interpolateOrRd,                            lo:"Getting younger",   hi:"Getting older",     title:"Median Age Change · 2016 → 2021 (years)",   diverge:false},
};

function colorMap(frame) {
  document.getElementById("map-title").textContent = "";
  document.getElementById("map-legend").innerHTML = "";

  if (frame === 1 || frame === 9) {
    g.selectAll(".province").transition().duration(600).attr("fill","#2a2620");
    return;
  }
  if (frame === 8) {
    const GROWING = new Set(["ON","BC","AB","QC"]);
    g.selectAll(".province").transition().duration(700)
      .attr("fill", d => {
        const abbr = d.properties["postal-code"];
        if (["NT","YT","NU"].includes(abbr)) return "#2a2620";
        return GROWING.has(abbr) ? "#1a3a52" : "#4a1a14";
      });
    document.getElementById("map-title").textContent = "Two Canadas · Growing (blue) vs Aging (red)";
    document.getElementById("map-legend").innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9px;color:var(--muted)">
        <div style="width:10px;height:10px;border-radius:2px;background:#1a3a52;flex-shrink:0"></div>Growing Canada
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9px;color:var(--muted)">
        <div style="width:10px;height:10px;border-radius:2px;background:#4a1a14;flex-shrink:0"></div>Aging Canada
      </div>`;
    return;
  }

  const cfg   = FRAME_CONFIG[frame];
  const valFn = getValFn(frame);
  const prNums = Object.keys(PR_INFO).map(Number);
  const vals  = prNums.map(pr => valFn(pr)).filter(v => v !== null && isFinite(v));
  if (!vals.length) return;

  let domain;
  if (cfg.diverge) {
    const maxAbs = Math.max(Math.abs(d3.min(vals)), Math.abs(d3.max(vals)));
    domain = [-maxAbs, maxAbs];
  } else {
    domain = d3.extent(vals);
  }
  const cScale = d3.scaleSequential(cfg.interp).domain(domain);

  g.selectAll(".province").transition().duration(700)
    .attr("fill", d => {
      const abbr = d.properties["postal-code"];
      if (["NT","YT","NU"].includes(abbr)) return "#2a2620";
      const pr   = ABBR_TO_PR[abbr];
      if (!pr) return "#2a2620";
      const v = valFn(pr);
      return (v !== null && isFinite(v)) ? cScale(v) : "#2a2620";
    });

  document.getElementById("map-title").textContent = cfg.title;
  const stops = d3.range(0,1.01,.2).map(t => cfg.interp(t)).join(",");
  document.getElementById("map-legend").innerHTML = `
    <span class="leg-lo">${cfg.lo}</span>
    <div class="leg-bar" style="background:linear-gradient(to right,${stops})"></div>
    <span class="leg-hi">${cfg.hi}</span>`;
}

// ── Tooltip ──
function onHover(e, d) {
  const abbr = d.properties["postal-code"];
  const pr   = ABBR_TO_PR[abbr];
  const info = PR_INFO[pr];
  if (!info) return;
  const d16 = DATA16[pr], d21 = DATA21[pr];
  if (!d16 || !d21) return;
  const rows = [];
  const gr = d16.pop > 0 ? ((d21.pop-d16.pop)/d16.pop*100).toFixed(1) : "—";
  const sign = v => v >= 0 ? "+" : "";

  if (currentFrame === 2) {
    rows.push({k:"Population (2016)", v: fmtPop(d16.pop)});
    rows.push({k:"Population (2021)", v: fmtPop(d21.pop)});
  } else if (currentFrame === 3) {
    rows.push({k:"Growth 2016→2021",  v: sign(+gr) + gr + "%"});
    rows.push({k:"2016",              v: fmtPop(d16.pop)});
    rows.push({k:"2021",              v: fmtPop(d21.pop)});
  } else if (currentFrame === 4) {
    rows.push({k:"Median income (AT) 2021", v: "$" + Math.round(d21.income_med/1000) + "k"});
    rows.push({k:"Median income (AT) 2016", v: "$" + Math.round(d16.income_med/1000) + "k"});
  } else if (currentFrame === 5) {
    const delta = d21.bach_pct - d16.bach_pct;
    rows.push({k:"Bachelor's+ change", v: sign(delta) + delta.toFixed(1) + " pp"});
    rows.push({k:"2016", v: d16.bach_pct.toFixed(1) + "%"});
    rows.push({k:"2021", v: d21.bach_pct.toFixed(1) + "%"});
  } else if (currentFrame === 6) {
    const delta = d21.immig_pct - d16.immig_pct;
    rows.push({k:"Immig. share change", v: sign(delta) + delta.toFixed(1) + " pp"});
    rows.push({k:"2016", v: d16.immig_pct.toFixed(1) + "%"});
    rows.push({k:"2021", v: d21.immig_pct.toFixed(1) + "%"});
  } else if (currentFrame === 7) {
    const delta = d21.median_age - d16.median_age;
    rows.push({k:"Median age change", v: sign(delta) + delta.toFixed(1) + " yr"});
    rows.push({k:"2016", v: d16.median_age.toFixed(1) + " yr"});
    rows.push({k:"2021", v: d21.median_age.toFixed(1) + " yr"});
  } else {
    // Explore / Two Canadas: show all
    rows.push({k:"Population (2021)",    v: fmtPop(d21.pop)});
    rows.push({k:"Growth 2016→21",       v: sign(+gr) + gr + "%"});
    rows.push({k:"Median income 2021",   v: "$" + Math.round(d21.income_med/1000) + "k"});
    rows.push({k:"Bachelor's+ 2021",     v: d21.bach_pct.toFixed(1) + "%"});
    rows.push({k:"Immig. share Δ",       v: sign(d21.immig_pct-d16.immig_pct) + (d21.immig_pct-d16.immig_pct).toFixed(1) + " pp"});
    rows.push({k:"Median age Δ",         v: sign(d21.median_age-d16.median_age) + (d21.median_age-d16.median_age).toFixed(1) + " yr"});
  }
  showTip(e, rows, info.name);
}
function showTip(e, rows, name) {
  const tip = document.getElementById("tip");
  tip.innerHTML = `<div class="tip-name">${name}</div>` +
    rows.map(r => `<div class="tip-row"><span class="tip-k">${r.k}</span><span class="tip-v">${r.v}</span></div>`).join("");
  tip.classList.add("show"); moveT(e);
}
function moveT(e) {
  const t = document.getElementById("tip");
  t.style.left = Math.min(e.clientX+14, window.innerWidth-240)+"px";
  t.style.top  = Math.max(e.clientY-10, 8)+"px";
}
function hideT() { document.getElementById("tip").classList.remove("show"); }
function fmtPop(v) {
  if (v>=1e6) return (v/1e6).toFixed(2)+"M";
  if (v>=1000) return (v/1000).toFixed(0)+"k";
  return v.toLocaleString();
}

// ── Rank tables ──
function buildRankTables() {
  const immigRows = Object.keys(PR_INFO).map(pr => {
    const d16=DATA16[pr], d21=DATA21[pr];
    if (!d16||!d21) return null;
    return {name:PR_INFO[pr].name, v16:d16.immig_pct, v21:d21.immig_pct, delta:+(d21.immig_pct-d16.immig_pct).toFixed(2)};
  }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

  const ageRows = Object.keys(PR_INFO).map(pr => {
    const d16=DATA16[pr], d21=DATA21[pr];
    if (!d16||!d21) return null;
    return {name:PR_INFO[pr].name, v16:d16.median_age, v21:d21.median_age, delta:+(d21.median_age-d16.median_age).toFixed(2)};
  }).filter(Boolean).sort((a,b)=>b.delta-a.delta);

  // HDGREE delta table
  const hdgreeRows = Object.keys(PR_INFO).map(pr => {
    const d16=DATA16[pr], d21=DATA21[pr];
    if (!d16||!d21) return null;
    return {name:PR_INFO[pr].name, v16:d16.bach_pct, v21:d21.bach_pct, delta:+(d21.bach_pct-d16.bach_pct).toFixed(2)};
  }).filter(Boolean).sort((a,b)=>b.delta-a.delta);
  const hdgreeEl = document.getElementById("hdgree-table");
  if (hdgreeEl) hdgreeEl.innerHTML = makeTable(
    hdgreeRows.slice(0,5),
    r => (r.delta>=0?"+":"")+r.delta.toFixed(1)+" pp",
    r => r.v16.toFixed(1)+"% → "+r.v21.toFixed(1)+"%",
    "#f472b6", "rank-delta-pos",
    "Top 5 provinces · bachelor's+ share increase 2016→2021",
    Math.max(...hdgreeRows.slice(0,5).map(r=>Math.abs(r.delta)),0.01)
  );

  document.getElementById("immig-table").innerHTML = makeTable(
    immigRows.slice(0,5),
    r => (r.delta>=0?"+":"")+r.delta.toFixed(1)+" pp",
    r => r.v16.toFixed(1)+"% → "+r.v21.toFixed(1)+"%",
    "#c084fc", "rank-delta-pos",
    "Top 5 provinces · immigrant share increase 2016→2021",
    Math.max(...immigRows.slice(0,5).map(r=>Math.abs(r.delta)),0.01)
  );

  document.getElementById("age-table").innerHTML = makeTable(
    ageRows.slice(0,5),
    r => (r.delta>=0?"+":"")+r.delta.toFixed(2)+" yr",
    r => r.v16.toFixed(1)+" → "+r.v21.toFixed(1)+" yr",
    "#e05c4a", "rank-delta-red",
    "Top 5 provinces · median age increase 2016→2021",
    Math.max(...ageRows.slice(0,5).map(r=>Math.abs(r.delta)),0.01)
  );
}

function makeTable(rows, deltaFmt, rangeFmt, barColor, deltaClass, note, maxDelta) {
  return `<table class="rank-table">
    <thead><tr><th>Province</th><th>Change</th><th>2016 → 2021</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td class="rank-city">${r.name}</td>
      <td class="${deltaClass}">${deltaFmt(r)}</td>
      <td class="rank-num">${rangeFmt(r)}</td>
      <td class="rank-bar-cell"><div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${(Math.abs(r.delta)/maxDelta*100).toFixed(0)}%;background:${barColor}"></div></div></td>
    </tr>`).join("")}</tbody>
  </table><div class="rank-note">${note}</div>`;
}

// ── Explore panel ──
document.getElementById("open-explore").addEventListener("click", () => {
  document.getElementById("explore-panel").classList.add("show");
  drawExplore();
});
document.getElementById("exp-close").addEventListener("click", () => {
  document.getElementById("explore-panel").classList.remove("show");
});
document.querySelectorAll("[data-exp]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-exp]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active"); expMetric = btn.dataset.exp; drawExplore();
  });
});

function drawExplore() {
  const wrap = document.getElementById("exp-map-wrap");
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const expSvg = d3.select("#exp-svg").attr("width",w).attr("height",h);
  expSvg.selectAll("*").remove();
  const gE = expSvg.append("g");
  const features = topojson.feature(topoData, topoData.objects.default);
  const eProj = d3.geoConicConformal().parallels([49,77]).rotate([96,0]).fitSize([w,h],features);
  const ePath = d3.geoPath().projection(eProj);
  const expZoom = d3.zoom().scaleExtent([0.5,8]).on("zoom",e=>gE.attr("transform",e.transform));
  expSvg.call(expZoom);
  // Allow single clicks to reach province elements (zoom only triggers on drag)
  expSvg.on("click.zoom", null);

  const frameMap = {pop:2, growth:3, income:4, hdgree:5, immig:6, age:7};
  const frame = frameMap[expMetric] || 2;
  const cfg = FRAME_CONFIG[frame];
  const valFn = getValFn(frame);
  const prNums = Object.keys(PR_INFO).map(Number);
  const vals = prNums.map(pr=>valFn(pr)).filter(v=>v!==null&&isFinite(v));
  let domain;
  if (cfg.diverge) { const m=Math.max(Math.abs(d3.min(vals)),Math.abs(d3.max(vals))); domain=[-m,m]; }
  else domain = d3.extent(vals);
  const cScale = d3.scaleSequential(cfg.interp).domain(domain);

  gE.selectAll("path").data(features.features).join("path")
    .attr("d",ePath).attr("stroke","#1a1612").attr("stroke-width",.8)
    .attr("fill", d => {
      const abbr=d.properties["postal-code"];
      if(["NT","YT","NU"].includes(abbr)) return "#2a2620";
      const pr=ABBR_TO_PR[abbr];
      if(!pr) return "#1e1b17";
      const v=valFn(pr);
      return (v!==null&&isFinite(v))?cScale(v):"#1e1b17";
    })
    .on("mouseover",(e,d)=>onHover(e,d)).on("mousemove",moveT).on("mouseout",hideT)
    .on("click",(e,d)=>{ e.stopPropagation(); handleCmpClick(d.properties["postal-code"]); });

  gE.selectAll("text").data(features.features).join("text")
    .attr("x",d=>ePath.centroid(d)[0]).attr("y",d=>ePath.centroid(d)[1])
    .attr("text-anchor","middle").attr("dominant-baseline","middle")
    .attr("font-family","var(--mono)").attr("font-size","9px")
    .attr("fill","rgba(238,232,220,0.45)").attr("pointer-events","none")
    .text(d=>d.properties["postal-code"]||"");

  const stops = d3.range(0,1.01,.2).map(t=>cfg.interp(t)).join(",");
  document.getElementById("exp-legend").innerHTML = `
    <span style="font-family:var(--mono);font-size:9px;color:var(--muted)">${cfg.lo}</span>
    <div style="background:linear-gradient(to right,${stops});height:6px;width:90px;border-radius:3px"></div>
    <span style="font-family:var(--mono);font-size:9px;color:var(--muted)">${cfg.hi}</span>`;
}

// ── Scrollama ──
function initScrollama() {
  const scroller = scrollama();
  scroller.setup({step:".step", offset:0.5})
    .onStepEnter(({element}) => {
      document.querySelectorAll(".step-card").forEach(c=>c.classList.remove("is-active"));
      element.querySelector(".step-card").classList.add("is-active");
      const f = +element.dataset.step;
      currentFrame = f;
      document.getElementById("hook-overlay").classList.toggle("hidden", f !== 1);
      colorMap(f);
    });
  window.addEventListener("resize", scroller.resize);
}

// ── Boot ──
setProgress(5, "Loading map…");
Promise.all([
  d3.json("data/canada_topo.json"),
  d3.csv("data/canada_census2016.csv"),
  d3.csv("data/canada_census2021.csv"),
]).then(([topo, rows16, rows21]) => {
  topoData = topo;
  setProgress(35, "Aggregating 2016 census…");
  setTimeout(() => {
    DATA16 = aggregatePR(rows16);
    setProgress(65, "Aggregating 2021 census…");
    setTimeout(() => {
      DATA21 = aggregatePR(rows21);
      setProgress(90, "Rendering…");
      setTimeout(() => {
        document.getElementById("loading").style.display = "none";
        initMap();
        buildRankTables();
        initCompare();
        initScrollama();
        colorMap(1);
        setProgress(100);
      }, 80);
    }, 50);
  }, 50);
}).catch(err => {
  document.getElementById("l-msg").textContent = "Error: " + err.message;
  console.error(err);
});

// ══════════════════════════════════════════════════════
//  COMPARE SIDEBAR
// ══════════════════════════════════════════════════════
let cmpSel = []; // max 2 province abbrs
let cmpOpen = false;

const CMP_METRICS = [
  { key:"growth",    label:"Population Growth 2016→21",  unit:"%",  color:"#2ecc71",
    fn: pr => { const d16=DATA16[pr],d21=DATA21[pr]; if(!d16||!d21||d16.pop===0) return 0; return +((d21.pop-d16.pop)/d16.pop*100).toFixed(1); } },
  { key:"income",    label:"Median After-Tax Income 2021", unit:"k", color:"#e8c57a",
    fn: pr => DATA21[pr] ? +(DATA21[pr].income_med/1000).toFixed(1) : 0 },
  { key:"hdgree",    label:"Bachelor's+ Change 2016→21",  unit:"pp", color:"#f472b6",
    fn: pr => { const d16=DATA16[pr],d21=DATA21[pr]; if(!d16||!d21) return 0; return +(d21.bach_pct-d16.bach_pct).toFixed(1); } },
  { key:"immig",     label:"Immigrant Share Change 2016→21", unit:"pp", color:"#c084fc",
    fn: pr => { const d16=DATA16[pr],d21=DATA21[pr]; if(!d16||!d21) return 0; return +(d21.immig_pct-d16.immig_pct).toFixed(1); } },
  { key:"age",       label:"Median Age Change 2016→21",   unit:"yr", color:"#e05c4a",
    fn: pr => { const d16=DATA16[pr],d21=DATA21[pr]; if(!d16||!d21) return 0; return +(d21.median_age-d16.median_age).toFixed(2); } },
];

function initCompare() {
  document.getElementById("cmp-toggle-btn").addEventListener("click", () => {
    cmpOpen = !cmpOpen;
    document.getElementById("cmp-sidebar").classList.toggle("open", cmpOpen);
    document.getElementById("cmp-toggle-btn").classList.toggle("active", cmpOpen);
    if (cmpOpen) drawCompare();
  });

  document.getElementById("cmp-clear").addEventListener("click", () => {
    cmpSel = [];
    updatePills();
    drawCompare();
    // reset map highlights
    d3.selectAll(".province").attr("stroke","#1a1612").attr("stroke-width",0.8);
  });
}

function handleCmpClick(abbr) {
  if (!cmpOpen) return;
  if (!abbr) return;
  const no_data = ["NT","YT","NU"];
  if (no_data.includes(abbr)) return;
  if (cmpSel.includes(abbr)) {
    cmpSel = cmpSel.filter(a => a !== abbr);
  } else {
    if (cmpSel.length >= 2) cmpSel.shift();
    cmpSel.push(abbr);
  }
  updatePills();
  highlightCmpProvs();
  drawCompare();
}

function updatePills() {
  const pillA = document.getElementById("pill-a");
  const pillB = document.getElementById("pill-b");
  if (cmpSel[0]) { pillA.textContent = cmpSel[0]; pillA.className = "cmp-pill a"; }
  else            { pillA.textContent = "Province A"; pillA.className = "cmp-pill"; }
  if (cmpSel[1]) { pillB.textContent = cmpSel[1]; pillB.className = "cmp-pill b"; }
  else            { pillB.textContent = "Province B"; pillB.className = "cmp-pill"; }
}

function highlightCmpProvs() {
  d3.selectAll(".province").each(function(d) {
    const abbr = d.properties["postal-code"];
    const idx = cmpSel.indexOf(abbr);
    if (idx === 0)      d3.select(this).attr("stroke","#4da3d4").attr("stroke-width", 2.5);
    else if (idx === 1) d3.select(this).attr("stroke","#e05c4a").attr("stroke-width", 2.5);
    else                d3.select(this).attr("stroke","#1a1612").attr("stroke-width", 0.8);
  });
}

function drawCompare() {
  const body = document.getElementById("cmp-sb-body");
  if (cmpSel.length === 0) {
    body.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:20px;line-height:1.8;text-align:center">Click any two provinces<br>on the map to compare</div>';
    return;
  }
  if (cmpSel.length === 1) {
    const pr = ABBR_TO_PR[cmpSel[0]];
    const info = PR_INFO[pr];
    body.innerHTML = '<div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:20px;line-height:1.8;text-align:center">Selected: <b style="color:var(--ink)">' + (info?.name||cmpSel[0]) + '</b><br>Click a second province<br>to compare</div>';
    return;
  }

  const [abbrA, abbrB] = cmpSel;
  const prA = ABBR_TO_PR[abbrA], prB = ABBR_TO_PR[abbrB];
  const nameA = PR_INFO[prA]?.name || abbrA;
  const nameB = PR_INFO[prB]?.name || abbrB;

  let html = `
    <div style="display:flex;gap:10px;margin-bottom:12px;font-family:var(--mono);font-size:9px">
      <div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:1px;background:#4da3d4"></div><span style="color:var(--ink)">${nameA}</span></div>
      <div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:1px;background:#e05c4a"></div><span style="color:var(--ink)">${nameB}</span></div>
    </div>`;

  CMP_METRICS.forEach(m => {
    const vA = m.fn(prA), vB = m.fn(prB);
    const maxAbs = Math.max(Math.abs(vA), Math.abs(vB), 0.01);
    const wA = (Math.abs(vA) / maxAbs * 100).toFixed(0);
    const wB = (Math.abs(vB) / maxAbs * 100).toFixed(0);
    const fmtA = (vA > 0 ? "+" : "") + vA + " " + m.unit;
    const fmtB = (vB > 0 ? "+" : "") + vB + " " + m.unit;

    html += `
      <div class="cmp-metric-block">
        <div class="cmp-metric-label">${m.label}</div>
        <div class="cmp-bar-row">
          <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;margin-bottom:2px">
            <span style="color:#a8d4f0">${abbrA}</span><span style="color:#a8d4f0">${fmtA}</span>
          </div>
          <div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:${wA}%;background:#4da3d4"></div></div>
        </div>
        <div class="cmp-bar-row">
          <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;margin-bottom:2px">
            <span style="color:#f0a8a0">${abbrB}</span><span style="color:#f0a8a0">${fmtB}</span>
          </div>
          <div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:${wB}%;background:#e05c4a"></div></div>
        </div>
      </div>
      <hr class="cmp-divider">`;
  });

  body.innerHTML = html;
}