/* ScintIm GNSS demo — source-agnostic Plotly consumer of a public JSON contract.
 * Refresh metadata every minute; only fetch large data if snapshot_id changes.
 * All timestamps are UTC. No computation here constitutes a calibrated S4/σφ.
 */
'use strict';

let currentMeta = null;
let allData = [];
const $ = (id) => document.getElementById(id);
const colors = {GPS:'#16838b', Galileo:'#956ec4'};
const cfg = {responsive:true, displaylogo:false, modeBarButtonsToRemove:['lasso2d','select2d']};
const baseLayout = {margin:{l:58,r:19,t:18,b:47},font:{family:'Inter,system-ui,sans-serif',size:11,color:'#4b6175'},paper_bgcolor:'#ffffff',plot_bgcolor:'#ffffff',hovermode:'x unified',showlegend:true,legend:{orientation:'h',y:1.17,x:0},xaxis:{title:{text:'UTC'},type:'date',gridcolor:'#edf1f6',zeroline:false,tickformat:'%H:%M'},yaxis:{gridcolor:'#edf1f6',zeroline:false}};
const mergeLayout = (parts) => ({...baseLayout,...parts,xaxis:{...baseLayout.xaxis,...(parts.xaxis||{})},yaxis:{...baseLayout.yaxis,...(parts.yaxis||{})}});
const line = (name,x,y,color,extra={}) => ({type:'scattergl',mode:'lines',name,x,y,line:{color,width:1.6},...extra});
const isValid = (r) => r.phase_valid === true && r.cycle_slip !== true;
const timestamp = (s) => s ? new Date(s).toISOString().replace('T',' ').replace('.000Z',' UTC') : '—';
const fmtAge = (s) => {const d=Math.max(0, Math.floor((Date.now()-Date.parse(s))/1000));return d<60?`${d}s`:d<3600?`${Math.floor(d/60)}m ${d%60}s`:`${Math.floor(d/3600)}h ${Math.floor(d%3600/60)}m`;};
const plot = (id,traces,layout) => window.Plotly.react(id,traces,layout,cfg);

function updateHeader() {
  if(!currentMeta)return;
  const mode = currentMeta.source === 'synthetic';
  $('mode').textContent = mode ? 'SYNTHETIC DATA · STATIC DEMO' : 'REAL RECEIVER DATA';
  $('mode').className = mode ? 'pill synthetic' : 'pill live';
  $('station').textContent = currentMeta.station_id || 'Undisclosed';
  $('last-utc').textContent = timestamp(currentMeta.last_observation_utc);
  $('age').textContent = fmtAge(currentMeta.last_observation_utc);
  $('metric-cadence').textContent = `${currentMeta.nominal_interval_seconds ?? '—'} s`;
  $('metric-status').textContent = mode ? 'Simulation' : (currentMeta.receiver_status || 'Unknown');
  $('snapshot-id').textContent = `Snapshot ${currentMeta.snapshot_id}`;
  const stale = Date.now() - Date.parse(currentMeta.last_observation_utc) > 15*60000;
  $('refresh-status').textContent = mode ? 'Static demonstration' : (stale ? 'Stale observations' : 'Recent observations');
  $('refresh-status').className = 'pill ' + (mode ? '' : (stale ? 'stale' : 'live'));
  $('notice').innerHTML = mode
    ? '<strong>Simulation only.</strong> No GNSS receiver was used. C/N0 variations and phase residuals illustrate possible analyses, but are not calibrated S4 or σφ.'
    : '<strong>Exploratory GNSS diagnostics.</strong> C/N0 fluctuations are not S4; phase residuals are not calibrated σφ. Relative dual-frequency phase is not absolute TEC. Check slips and local multipath.';
}

function availableSats() {return [...new Set(allData.map(r=>r.sv))].sort();}
function populateSelectors() {
  const oldSv = $('sv').value || 'G14';
  $('sv').replaceChildren(...availableSats().map(s=>new Option(s,s)));
  $('sv').value = availableSats().includes(oldSv) ? oldSv : availableSats()[0];
  populateSignals();
}
function populateSignals() {
  const old=$('signal').value;
  const signals=[...new Set(allData.filter(r=>r.sv===$('sv').value).map(r=>r.signal))];
  $('signal').replaceChildren(new Option('All signals','all'),...signals.map(s=>new Option(s,s)));
  $('signal').value = signals.includes(old) ? old : 'all';
}
function chosenRows() {
  if(!allData.length)return [];
  const end=Date.parse(currentMeta.last_observation_utc);
  const from=end-Number($('window').value)*60_000;
  return allData.filter(r=>r.sv===$('sv').value && (r.signal===$('signal').value || $('signal').value==='all') && Date.parse(r.t)>=from);
}
function windowRows() {
  const from=Date.parse(currentMeta.last_observation_utc)-Number($('window').value)*60_000;
  return allData.filter(r=>Date.parse(r.t)>=from);
}
function bySignal(rows) {
  return Object.groupBy ? Object.groupBy(rows,r=>r.signal) : rows.reduce((a,r)=>{(a[r.signal]??=[]).push(r);return a;},{});
}
function selectedTraces(rows,field,validOnly=false) {
  return Object.entries(bySignal(rows)).map(([s,arr],idx)=>line(s,arr.map(r=>r.t),arr.map(r=>validOnly&&!isValid(r)?null:r[field]),idx===0?'#158496':'#a177c6'));
}
function renderSky(rows) {
  const last=currentMeta.last_observation_utc;
  const seen=new Map();
  for(const r of rows)if(r.t===last&&!seen.has(r.sv))seen.set(r.sv,r);
  const traces=Object.entries(colors).map(([gnss,color])=>{
    const sats=[...seen.values()].filter(r=>r.gnss===gnss);
    return {type:'scatterpolar',mode:'markers+text',name:gnss,theta:sats.map(r=>r.az_deg),r:sats.map(r=>90-r.el_deg),text:sats.map(r=>r.sv),textposition:'top center',marker:{color,size:9},hovertemplate:'%{text}<br>Azimuth %{theta:.0f}°<br>Elevation %{customdata:.0f}°<extra></extra>',customdata:sats.map(r=>r.el_deg)};
  });
  plot('skyplot',traces,{margin:{l:35,r:35,t:5,b:15},font:baseLayout.font,paper_bgcolor:'#fff',showlegend:true,legend:{orientation:'h',x:0,y:1.11},polar:{bgcolor:'#fff',radialaxis:{range:[0,90],tickvals:[0,30,60,90],ticktext:['90°','60°','30°','0°'],angle:90,gridcolor:'#dfe6ee'},angularaxis:{direction:'clockwise',rotation:90,gridcolor:'#e8edf3',tickmode:'array',tickvals:[0,90,180,270],ticktext:['N','E','S','W']}}});
  $('metric-sats').textContent=seen.size;
  $('metric-signals').textContent=rows.filter(r=>r.t===last).length;
}
function makeGF(rows) {
  const selected=$('sv').value;
  const sat=rows.filter(r=>r.sv===selected);
  const times=new Map();
  for(const r of sat){if(!times.has(r.t))times.set(r.t,[]);times.get(r.t).push(r);}
  const x=[],y=[];let reference=null;let prevTime=null;let maxGapSec=2*(currentMeta.nominal_interval_seconds||5);
  for(const [t,pair] of times){
    if(pair.length<2)continue;
    const p=pair.slice().sort((a,b)=>b.frequency_hz-a.frequency_hz);
    if(!p.every(isValid)) {reference=null;x.push(t);y.push(null);continue;}
    const gap=prevTime===null?0:(Date.parse(t)-Date.parse(prevTime))/1000;
    const gf=p[0].carrier_phase_cycles*299792458/p[0].frequency_hz-p[1].carrier_phase_cycles*299792458/p[1].frequency_hz;
    if(reference===null||gap>maxGapSec) {reference=gf;x.push(t);y.push(null);} else {x.push(t);y.push(gf-reference);}
    prevTime=t;
  }
  return line('Geometry-free ΔL',x,y,'#ad6c31');
}
function renderHealth(rows) {
  const byEpoch = new Map(); const slips=[];
  for(const r of rows){if(!byEpoch.has(r.t))byEpoch.set(r.t,new Set());byEpoch.get(r.t).add(r.sv);if(r.cycle_slip)slips.push(r);}
  const times=[...byEpoch.keys()]; const ns=times.map(t=>byEpoch.get(t).size);
  const trace=line('Tracked SVs',times,ns,'#17828b',{fill:'tozeroy',fillcolor:'rgba(22,130,139,.07)'});
  const markers={type:'scatter',mode:'markers',name:'Cycle-slip flags',x:slips.map(r=>r.t),y:slips.map(r=>byEpoch.get(r.t).size),marker:{symbol:'x',color:'#c34b4c',size:10},text:slips.map(r=>r.sv+' '+r.signal),hovertemplate:'%{text}<br>%{x}<extra></extra>'};
  plot('healthplot',[trace,markers],mergeLayout({yaxis:{title:'Satellites',rangemode:'tozero',dtick:2}}));
}
function phaseTraces(rows) {
  if ($('phase-mode').value === 'residual') {
    $('phase-description').textContent = 'Illustrative detrended phase [cycles] · not calibrated σφ';
    return selectedTraces(rows, 'phase_residual_cycles', true);
  }
  $('phase-description').textContent = 'Carrier phase − first valid phase [cycles] · arbitrary ambiguity';
  return Object.entries(bySignal(rows)).map(([sig,arr],i)=>{
    const first=arr.find(isValid)?.carrier_phase_cycles;
    return line(sig,arr.map(r=>r.t),arr.map(r=>isValid(r) && first!=null?r.carrier_phase_cycles-first:null),i===0?'#158496':'#a177c6');
  });
}
function render() {
  if(!currentMeta||!allData.length)return;
  const rows=chosenRows(), windowed=windowRows();
  renderSky(allData);
  plot('cn0plot',selectedTraces(rows,'cn0_dbhz'),mergeLayout({yaxis:{title:'dB-Hz'}}));
  plot('phaseplot',phaseTraces(rows),mergeLayout({yaxis:{title:'cycles'}}));
  plot('dopplerplot',selectedTraces(rows,'doppler_hz'),mergeLayout({yaxis:{title:'Hz'}}));
  plot('gfplot',[makeGF(windowed)],mergeLayout({yaxis:{title:'Relative ΔL [m]'}}));
  renderHealth(windowed);
  $('filter-caption').textContent=`${rows.length.toLocaleString()} signal samples · UTC`;
}
async function refresh() {
  try {
    const metaResponse=await fetch(`data/latest.json?cb=${Date.now()}`,{cache:'no-store'});
    if(!metaResponse.ok)throw new Error(`Metadata HTTP ${metaResponse.status}`);
    const meta=await metaResponse.json();
    if(meta.schema_version!=='0.1.0')throw new Error(`Unsupported schema ${meta.schema_version}`);
    if(!currentMeta||meta.snapshot_id!==currentMeta.snapshot_id){
      const dataResponse=await fetch(`data/observations.json?cb=${encodeURIComponent(meta.snapshot_id)}`,{cache:'no-store'});
      if(!dataResponse.ok)throw new Error(`Observations HTTP ${dataResponse.status}`);
      const data=await dataResponse.json();
      if(data.snapshot_id!==meta.snapshot_id)throw new Error('Snapshot IDs differ; publication may be in progress.');
      if(!Array.isArray(data.observations))throw new Error('Observations missing');
      allData=data.observations;
      currentMeta=meta;
      populateSelectors();
      render();
    }
    updateHeader();
  }catch(err){$('refresh-status').className='pill stale';$('refresh-status').textContent='Data fetch error';$('notice').textContent=`Could not refresh public data: ${err.message}. For local testing, serve docs/ using python -m http.server, not file://.`;console.error(err);}
}
$('sv').addEventListener('change',()=>{populateSignals();render();});
$('signal').addEventListener('change',render);
$('window').addEventListener('change',render);
$('phase-mode').addEventListener('change',render);
$('reload').addEventListener('click',refresh);
window.addEventListener('resize',()=>{for(const id of ['skyplot','cn0plot','phaseplot','dopplerplot','gfplot','healthplot']){if($(id).data)Plotly.Plots.resize($(id));}});
refresh();
setInterval(refresh,60_000);
setInterval(updateHeader,30_000);
