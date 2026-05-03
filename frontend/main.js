// SENTINEL-4 — Analog Imperfections Build
const WS_URL=`ws://${window.location.hostname}:8765`;
const TRAIL_LEN=20;
let W,H,CX,CY,RAD;
const canvas=document.getElementById('radar');
const ctx=canvas.getContext('2d');

// Jitter helper: random offset ±px
function jit(v,px){return v+(Math.random()-0.5)*px*2}

const S={tracks:[],swarms:[],preds:{},stats:{},trails:{},
    connected:false,paused:false,sweep:-Math.PI/2,frame:0,
    prevIds:new Set(),prevSw:0,mouseX:-1,mouseY:-1,
    sweepSpeed:0.045,lastReadout:0,stutterUntil:0};

const LOG=[];
function log(m,hi){
    LOG.push({t:new Date().toLocaleTimeString('en-US',{hour12:false}),m,hi});
    if(LOG.length>50)LOG.shift();
}

// Grain
function initGrain(){
    const gc=document.getElementById('grain'),gx=gc.getContext('2d');
    function render(){
        gc.width=window.innerWidth;gc.height=window.innerHeight;
        const id=gx.createImageData(gc.width,gc.height),d=id.data;
        for(let i=0;i<d.length;i+=4){const v=Math.random()*50;d[i]=v*0.2;d[i+1]=v;d[i+2]=0;d[i+3]=255;}
        gx.putImageData(id,0,0);
    }
    render();setInterval(render,100);
}

function sizeCanvas(){
    const el=document.getElementById('scope');
    const s=Math.floor(Math.min(el.clientWidth-8,el.clientHeight-8));
    if(s<50)return;
    canvas.width=s;canvas.height=s;W=H=s;CX=CY=s/2;RAD=s/2-14;
}

// WebSocket
let ws=null,rc=null;
function connectWS(){
    if(ws&&ws.readyState<=1)return;
    ws=new WebSocket(WS_URL);
    ws.onopen=()=>{S.connected=true;
        document.getElementById('conn').textContent='● ONLINE';
        document.getElementById('conn').className='on';log('UPLINK ESTABLISHED',true);};
    ws.onmessage=(e)=>{try{handleData(JSON.parse(e.data))}catch(er){}};
    ws.onclose=()=>{S.connected=false;
        document.getElementById('conn').textContent='● OFFLINE';
        document.getElementById('conn').className='';rc=setTimeout(connectWS,2000);};
    ws.onerror=()=>ws.close();
}
function send(c){if(ws&&ws.readyState===1)ws.send(JSON.stringify(c))}

function handleData(d){
    S.tracks=d.tracks||[];S.swarms=d.swarms||[];
    S.preds=d.predictions||{};S.stats=d.stats||{};
    for(const t of S.tracks){
        if(!S.trails[t.track_id])S.trails[t.track_id]=[];
        const tr=S.trails[t.track_id];tr.push({x:t.x,y:t.y});
        if(tr.length>TRAIL_LEN)tr.shift();
    }
    const act=new Set(S.tracks.map(t=>t.track_id));
    for(const id of Object.keys(S.trails))if(!act.has(parseInt(id)))delete S.trails[id];
    for(const t of S.tracks)if(!S.prevIds.has(t.track_id))
        log(`TRK ${String(t.track_id).padStart(3,'0')} ACQUIRED ${t.confirmed?'STRONG':'WEAK'}`);
    for(const id of S.prevIds)if(!act.has(id))log(`TRK ${String(id).padStart(3,'0')} LOST`,true);
    S.prevIds=act;
    if(S.swarms.length>S.prevSw)log(`▸ SWARM CONTACT ${S.swarms.length} GROUP${S.swarms.length>1?'S':''}`,true);
    else if(S.swarms.length===0&&S.prevSw>0)log('SWARM CLEARED');
    S.prevSw=S.swarms.length;
    // Staggered readout update (not every tick)
    if(Date.now()-S.lastReadout>300+Math.random()*200){S.lastReadout=Date.now();updateReadout();}
}

// === READOUT (right panel as raw text) ===
function updateReadout(){
    const s=S.stats,conf=s.num_confirmed??0,tot=s.num_tracks??0;
    const sigPct=tot>0?Math.round(conf/tot*100):0;
    const noisePct=Math.min(100,S.swarms.length*25+S.tracks.length*2);
    const intPct=Math.min(100,S.swarms.reduce((a,sw)=>a+(sw.member_ids.length>4?30:10),0));
    let swT=' NO CONTACTS\n';
    for(const sw of S.swarms){
        const coh=(sw.coherence*100).toFixed(0);
        swT+=` SW-${String(sw.swarm_id).padStart(2,'0')} ${sw.formation.toUpperCase().padEnd(8)} ${sw.member_ids.length}T\n`;
        swT+=`   COH:${nbar(sw.coherence*100,8)} ${coh.padStart(3)}%\n`;
        swT+=`   ${sw.is_coordinated?'COORDINATED':'UNCOORD'}  (${sw.center[0]},${sw.center[1]})\n`;
    }
    const logL=LOG.slice(-8).map(l=>` ${l.t.substring(0,8)} ${l.m}`).join('\n');
    let ptr=' X:---  Y:---\n BRG:---°  RNG:---m';
    if(S.mouseX>=0&&RAD>0){
        const dx=S.mouseX-CX,dy=S.mouseY-CY,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<=RAD){
            let brg=Math.round(Math.atan2(dx,-dy)*180/Math.PI);if(brg<0)brg+=360;
            ptr=` X:${String(Math.round(S.mouseX)).padStart(3)}  Y:${String(Math.round(S.mouseY)).padStart(3)}\n BRG:${String(brg).padStart(3)}°  RNG:${String(Math.round(dist/RAD*400)).padStart(3)}m`;
        }
    }
    document.getElementById('readout').textContent=
`══════ SIGNAL LOG ═══════
${logL}

══════ TELEMETRY ════════
 TRACKS: ${String(tot).padStart(2,'0')}    CONF: ${String(conf).padStart(2,'0')}
 SWARMS: ${String(s.num_swarms??0).padStart(2,'0')}  DETECT: ${String(s.num_detections??0).padStart(2,'0')}
 TICK: ${String(s.tick??'----').padStart(5)}

══════ SWARM DATA ═══════
${swT}
══════ SIGNAL ═══════════
 SIG: ${nbar(sigPct,10)} ${sigPct>70?'GOOD':sigPct>40?'FAIR':'WEAK'}
 NSE: ${nbar(noisePct,10)} ${noisePct>60?'HIGH':noisePct>25?'MED':'LOW'}
 INT: ${nbar(intPct,10)} ${intPct>50?'HIGH':intPct>20?'MED':'NONE'}

══════ POINTER ══════════
${ptr}
══════════════════════════
 SENTINEL-4 REV 3.2.1`;
    document.getElementById('tickd').textContent=`TICK:${String(s.tick??'----').padStart(4)}`;
}
// Noisy bar: randomly glitches 1-2 segments
function nbar(pct,len){
    const f=Math.round(pct/100*len);
    let out='';
    for(let i=0;i<len;i++){
        const shouldFill=i<f;
        // 8% chance of glitch (filled shows empty or vice versa)
        if(Math.random()<0.08) out+=shouldFill?'▓':'░';
        else out+=shouldFill?'█':'░';
    }
    return out;
}

// === CANVAS ===
function drawFrame(){
    S.frame++;
    // Micro-stutter: occasionally freeze for 2-3 frames
    if(S.frame===S.stutterUntil)S.stutterUntil=0;
    if(S.stutterUntil>0)return requestAnimationFrame(drawFrame);
    if(Math.random()<0.003)S.stutterUntil=S.frame+Math.floor(Math.random()*3)+2;

    // Phosphor persistence (slightly variable decay)
    const decay=0.14+Math.random()*0.04;
    ctx.fillStyle=`rgba(0,5,0,${decay})`;
    ctx.fillRect(0,0,W,H);

    drawGrid();drawSweep();drawSwarms();drawTrails();drawPredictions();drawTracks();drawNoise();drawMask();
    requestAnimationFrame(drawFrame);
}

function drawGrid(){
    // Range rings with slight imperfection
    for(let r=RAD/4;r<=RAD;r+=RAD/4){
        ctx.strokeStyle='#002808';ctx.lineWidth=0.5+Math.random()*0.3;
        ctx.beginPath();ctx.arc(jit(CX,0.5),jit(CY,0.5),r,0,Math.PI*2);ctx.stroke();
    }
    // Bearing lines — slight wobble
    ctx.lineWidth=0.4;
    for(let a=0;a<360;a+=30){
        ctx.strokeStyle=`rgba(0,26,6,${0.7+Math.random()*0.3})`;
        const r=(a-90)*Math.PI/180;
        ctx.beginPath();ctx.moveTo(CX,CY);
        ctx.lineTo(CX+Math.cos(r)*RAD+jit(0,0.8),CY+Math.sin(r)*RAD+jit(0,0.8));ctx.stroke();
    }
    // Center cross
    ctx.strokeStyle='#004010';ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(CX-6,jit(CY,0.3));ctx.lineTo(CX+6,jit(CY,0.3));
    ctx.moveTo(jit(CX,0.3),CY-6);ctx.lineTo(jit(CX,0.3),CY+6);ctx.stroke();
    // Range labels
    ctx.fillStyle='#003310';ctx.font=`${Math.max(10,RAD/24)}px VT323,monospace`;ctx.textAlign='left';
    for(let i=1;i<=4;i++)ctx.fillText(`${i*100}`,CX+RAD/4*i+3,jit(CY-2,0.8));
}

function drawSweep(){
    // Variable speed: randomly drift ±15%
    if(S.frame%80===0)S.sweepSpeed=0.045+(Math.random()-0.5)*0.014;
    // Step every 2-4 frames (irregular)
    const stepInterval=2+Math.floor(Math.random()*0.5);
    if(S.frame%stepInterval===0)S.sweep+=S.sweepSpeed+(Math.random()-0.5)*0.006;
    const a=S.sweep;
    const ex=CX+Math.cos(a)*RAD,ey=CY+Math.sin(a)*RAD;
    // Brightness falloff: center to edge
    const g=ctx.createLinearGradient(CX,CY,ex,ey);
    g.addColorStop(0,'rgba(0,180,30,0.7)');
    g.addColorStop(0.5,'rgba(0,130,20,0.4)');
    g.addColorStop(1,'rgba(0,80,15,0.08)');
    ctx.strokeStyle=g;ctx.lineWidth=1.5+Math.random()*0.5;
    ctx.beginPath();ctx.moveTo(CX,CY);ctx.lineTo(ex,ey);ctx.stroke();
    // Afterglow trail
    ctx.fillStyle='rgba(0,70,12,0.01)';
    ctx.beginPath();ctx.moveTo(CX,CY);
    ctx.arc(CX,CY,RAD,a-0.7,a);ctx.closePath();ctx.fill();
    // Brighter near-trail
    ctx.fillStyle='rgba(0,100,18,0.008)';
    ctx.beginPath();ctx.moveTo(CX,CY);
    ctx.arc(CX,CY,RAD,a-0.25,a);ctx.closePath();ctx.fill();
}

function drawTrails(){
    for(const[id,trail]of Object.entries(S.trails)){
        if(trail.length<2)continue;
        const t=S.tracks.find(t=>t.track_id===parseInt(id));
        const c=t&&t.confirmed;
        for(let i=1;i<trail.length;i++){
            const al=(i/trail.length)*(c?0.25:0.08);
            ctx.strokeStyle=`rgba(51,255,0,${al})`;
            ctx.lineWidth=c?1:0.5;
            ctx.beginPath();ctx.moveTo(trail[i-1].x,trail[i-1].y);
            ctx.lineTo(trail[i].x,trail[i].y);ctx.stroke();
        }
    }
}

function drawTracks(){
    ctx.font=`${Math.max(9,RAD/28)}px VT323,monospace`;
    for(const t of S.tracks){
        let{x,y,track_id,confirmed}=t;
        // Signal loss: 6% chance of complete dropout
        if(Math.random()<0.06)continue;
        // Distance check
        if(Math.sqrt((x-CX)**2+(y-CY)**2)>RAD)continue;
        // Jitter position (analog signal noise)
        x=jit(x,0.8);y=jit(y,0.8);
        // Vary intensity per track per frame
        const bright=0.7+Math.random()*0.3;
        if(confirmed){
            const g=Math.round(255*bright);
            ctx.strokeStyle=`rgb(${Math.round(g*0.2)},${g},0)`;
            ctx.lineWidth=1+Math.random()*0.4;
            ctx.beginPath();
            ctx.moveTo(x-5,y);ctx.lineTo(x+5,y);
            ctx.moveTo(x,y-5);ctx.lineTo(x,y+5);ctx.stroke();
            ctx.fillStyle=ctx.strokeStyle;
            ctx.fillRect(x-0.8,y-0.8,1.6,1.6);
            // Label with jitter
            ctx.fillStyle=`rgba(0,${Math.round(153*bright)},38,${bright})`;
            ctx.textAlign='left';
            ctx.fillText(String(track_id),jit(x+7,0.5),jit(y-2,0.5));
        }else{
            ctx.strokeStyle=`rgba(0,64,21,${0.4+Math.random()*0.3})`;
            ctx.lineWidth=0.7;
            ctx.strokeRect(x-2.5,y-2.5,5,5);
        }
    }
}

function drawPredictions(){
    ctx.setLineDash([2,4]);
    for(const[tid,preds]of Object.entries(S.preds)){
        if(!preds||!preds.length)continue;
        const t=S.tracks.find(t=>t.track_id===parseInt(tid));if(!t)continue;
        let px=t.x,py=t.y;
        for(let i=0;i<preds.length;i++){
            const al=0.18-i*0.025;
            ctx.strokeStyle=`rgba(0,153,38,${Math.max(al,0.03)})`;ctx.lineWidth=0.5;
            ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(preds[i].x,preds[i].y);ctx.stroke();
            px=preds[i].x;py=preds[i].y;
        }
    }
    ctx.setLineDash([]);
}

function convexHull(pts){
    if(pts.length<3)return pts.slice();let lo=0;
    for(let i=1;i<pts.length;i++)if(pts[i][1]>pts[lo][1]||(pts[i][1]===pts[lo][1]&&pts[i][0]<pts[lo][0]))lo=i;
    const p=pts[lo],s=pts.filter((_,i)=>i!==lo).sort((a,b)=>
        Math.atan2(a[1]-p[1],a[0]-p[0])-Math.atan2(b[1]-p[1],b[0]-p[0]));
    const h=[p,s[0]];
    for(let i=1;i<s.length;i++){while(h.length>1){const a=h[h.length-2],b=h[h.length-1],c=s[i];
        if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<=0)h.pop();else break;}h.push(s[i]);}return h;
}

function drawSwarms(){
    for(const sw of S.swarms){
        if(!sw.positions||sw.positions.length<2)continue;
        const hull=convexHull(sw.positions.map(p=>[p[0],p[1]]));if(hull.length<2)continue;
        // Hull with slight wobble
        ctx.strokeStyle=`rgba(0,${130+Math.round(Math.random()*25)},${20+Math.round(Math.random()*10)},${0.5+Math.random()*0.2})`;
        ctx.lineWidth=1+Math.random()*0.3;ctx.setLineDash([4+Math.round(Math.random()*2),3+Math.round(Math.random()*2)]);
        ctx.beginPath();ctx.moveTo(jit(hull[0][0],1),jit(hull[0][1],1));
        for(let i=1;i<hull.length;i++)ctx.lineTo(jit(hull[i][0],1),jit(hull[i][1],1));
        ctx.closePath();ctx.stroke();ctx.setLineDash([]);
        const pa=0.02+0.01*Math.sin(Date.now()/500);
        ctx.fillStyle=`rgba(51,255,0,${pa})`;ctx.fill();
        const cx=sw.center[0],cy=sw.center[1];
        ctx.fillStyle=`rgba(0,${130+Math.round(Math.random()*25)},30,${0.6+Math.random()*0.2})`;
        ctx.font=`${Math.max(10,RAD/26)}px VT323,monospace`;ctx.textAlign='center';
        ctx.fillText(`SW${sw.swarm_id}`,jit(cx,0.8),jit(cy-6,0.8));
        // Dense swarm interference
        const nCount=sw.member_ids.length>4?40:sw.member_ids.length>2?15:5;
        const spread=30+sw.member_ids.length*8;
        for(let i=0;i<nCount;i++){
            ctx.fillStyle=`rgba(51,255,0,${Math.random()*0.2})`;
            ctx.fillRect(cx+(Math.random()-0.5)*spread,cy+(Math.random()-0.5)*spread,
                Math.random()<0.3?2:1,1);
        }
    }
}

function drawNoise(){
    // Background static
    for(let i=0;i<60;i++){
        const a=Math.random()*Math.PI*2,d=Math.random()*RAD;
        ctx.fillStyle=`rgba(51,255,0,${Math.random()*0.07})`;
        ctx.fillRect(CX+Math.cos(a)*d,CY+Math.sin(a)*d,1,1);
    }
    // Occasional bright noise burst
    if(Math.random()<0.02){
        for(let i=0;i<20;i++){
            const a=Math.random()*Math.PI*2,d=Math.random()*RAD*0.6;
            ctx.fillStyle=`rgba(51,255,0,${0.1+Math.random()*0.15})`;
            ctx.fillRect(CX+Math.cos(a)*d,CY+Math.sin(a)*d,1+Math.random(),1);
        }
    }
    // Horizontal interference lines (random)
    if(Math.random()<0.04){
        const ly=Math.random()*H;
        ctx.strokeStyle=`rgba(51,255,0,${0.03+Math.random()*0.04})`;
        ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(0,ly);ctx.lineTo(W,ly);ctx.stroke();
    }
}

function drawMask(){
    ctx.fillStyle='#000600';ctx.beginPath();ctx.rect(0,0,W,H);
    ctx.arc(CX,CY,RAD+1,0,Math.PI*2,true);ctx.fill();
    // Bezel with slight brightness variation
    ctx.strokeStyle=`rgba(0,${45+Math.round(Math.random()*10)},${14+Math.round(Math.random()*5)},1)`;
    ctx.lineWidth=2;ctx.beginPath();ctx.arc(CX,CY,RAD,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#003310';
    ctx.font=`${Math.max(11,RAD/22)}px VT323,monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('N',jit(CX,0.5),CY-RAD-9);ctx.fillText('S',jit(CX,0.5),CY+RAD+9);
    ctx.fillText('E',CX+RAD+10,jit(CY,0.5));ctx.fillText('W',CX-RAD-10,jit(CY,0.5));
}

canvas.addEventListener('mousemove',(e)=>{
    const r=canvas.getBoundingClientRect();
    S.mouseX=(e.clientX-r.left)*(W/r.width);S.mouseY=(e.clientY-r.top)*(H/r.height);
});
canvas.addEventListener('mouseleave',()=>{S.mouseX=-1;S.mouseY=-1;});

document.getElementById('mode').addEventListener('click',()=>{
    S.paused=!S.paused;const el=document.getElementById('mode');
    el.textContent=S.paused?'MODE:HOLD':'MODE:RUN';el.className=S.paused?'paused':'';
    send({command:'toggle'});log(S.paused?'HOLD':'RUN');
});
document.getElementById('scn').addEventListener('change',(e)=>{
    send({command:'set_scenario',scenario:e.target.value});
    for(const k of Object.keys(S.trails))delete S.trails[k];
    log(`SCN: ${e.target.options[e.target.selectedIndex].text}`);
});
document.addEventListener('keydown',(e)=>{
    if(e.code==='Space'&&e.target===document.body){e.preventDefault();document.getElementById('mode').click();}
});

function updateClock(){
    document.getElementById('clock').textContent=new Date().toLocaleTimeString('en-US',{hour12:false});
    setTimeout(updateClock,1000);
}

log('SENTINEL-4 BOOT');log('SELF-TEST OK');log('AWAITING UPLINK');
function boot(){
    sizeCanvas();
    const el=document.getElementById('scope');
    if(el.clientWidth<100||el.clientHeight<100){setTimeout(boot,50);return;}
    sizeCanvas();initGrain();connectWS();updateClock();updateReadout();
    requestAnimationFrame(drawFrame);
}
window.addEventListener('resize',()=>sizeCanvas());
requestAnimationFrame(()=>requestAnimationFrame(boot));
