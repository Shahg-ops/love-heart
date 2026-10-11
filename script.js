'use strict';

// All shapes are formed ONLY from phrases, not a drawn heart stroke.
// Timings are deliberately calm: outline first, then a top-to-bottom fill.
const OUTLINE_DURATION = 6400;
const FILL_BEGINS = 5750;
const FILL_DURATION = 7800;
const PHRASE_FADE = 350;

const WORDS = [
  'I love you', 'Te amo', 'Je t’aime', 'Ti amo', 'Ich liebe dich',
  'Seni seviyorum', 'Eu te amo', 'Te quiero', 'Kocham cię',
  '사랑해', '愛してる', '我爱你', 'Anh yêu em', 'Aku cinta kamu',
  'Ik hou van jou', 'Jag älskar dig', 'Σ’ αγαπώ', 'Te iubesc',
  'Mahal kita', 'Я тебя люблю', 'أحبك', 'ฉันรักเธอ',
  'Love', 'Amore', 'Amor', 'Mon amour', 'I ♡ U'
];

const canvas = document.getElementById('heartCanvas');
const ctx = canvas.getContext('2d');
const music = document.getElementById('music');
const replayBtn = document.getElementById('replayBtn');
const soundBtn = document.getElementById('soundBtn');
const soundLabel = document.getElementById('soundLabel');
const tapHint = document.getElementById('tapHint');

let words = [];
let view = { width: 0, height: 0, font: 12 };
let startTime = performance.now();
let soundUnavailable = false;
let userMuted = false;

function randomMaker(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
    y: u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
  };
}

function heartPath() {
  // Hand-tuned rounded lobes / sloping cheeks / a visibly pointed bottom.
  const right = [
    [[0, -.54], [.20, -.83], [.43, -1.015], [.65, -.97]],
    [[.65, -.97], [1.035, -.92], [1.16, -.58], [1.01, -.21]],
    [[1.01, -.21], [.86, .16], [.49, .70], [0, 1.13]]
  ];
  const points = [];
  for (const [a,b,c,d] of right) {
    for (let i=0; i<120; i++) points.push(bezier(a,b,c,d,i/120));
  }
  points.push({x:0,y:1.13});
  // Path order is valley -> right lobe -> tip -> left lobe -> valley.
  const mirrored = points.slice(1,-1).reverse().map(p=>({x:-p.x,y:p.y}));
  return [...points, ...mirrored, {x:0,y:-.54}];
}

function intervalsAt(path, y) {
  const cuts=[];
  for (let i=0;i<path.length-1;i++) {
    const a=path[i], b=path[i+1];
    if ((a.y<=y && b.y>y) || (b.y<=y && a.y>y)) {
      cuts.push(a.x + (y-a.y)*(b.x-a.x)/(b.y-a.y));
    }
  }
  cuts.sort((a,b)=>a-b);
  const out=[];
  for(let i=0;i+1<cuts.length;i+=2) out.push([cuts[i],cuts[i+1]]);
  return out;
}

function clippedRanges(path, baseline, font) {
  // Fit the ENTIRE text inside the heart (top of glyph to baseline).
  const levels=[baseline-font*.95, baseline-font*.45, baseline+font*.06];
  let ranges=intervalsAt(path,levels[0]);
  for (const y of levels.slice(1)) {
    const intersections=[];
    for (const [a,b] of ranges) for(const [c,d] of intervalsAt(path,y)) {
      if (Math.min(b,d)>Math.max(a,c)) intersections.push([Math.max(a,c),Math.min(b,d)]);
    }
    ranges=intersections;
  }
  return ranges.map(([a,b])=>[a+2,b-2]).filter(([a,b])=>b-a>=8);
}

function nearestOutlineFraction(path, x,y) {
  // The path is sampled in travel order, so nearer points appear earlier.
  let nearest=0, best=Infinity;
  for(let i=0;i<path.length;i++) {
    const dx=x-path[i].x, dy=y-path[i].y;
    const d=dx*dx+dy*dy;
    if(d<best) { best=d; nearest=i; }
  }
  return nearest/(path.length-1);
}

function fillRow(left, right, y, opts, random, row, section) {
  const available=right-left;
  const small=opts.reduce((a,b)=>Math.min(a,b.width),Infinity);
  if(available<small) return [];
  const gapMin=Math.max(7.2,view.font*.69);
  const candidates=[];
  // Try several different word combinations; retain the tightly packed one.
  for(let trial=0;trial<95;trial++) {
    const selected=[];
    let taken=0;
    for(let j=0;j<24;j++) {
      const remaining=available-taken-(selected.length?gapMin:0);
      const fitting=opts.filter(o=>o.width<=remaining &&
        (selected.length===0 || o.text!==selected[selected.length-1].text));
      if(!fitting.length) break;
      // Occasionally prefer short translations to preserve the heart silhouette.
      const target=remaining<small*2+gapMin ? small : Math.min(remaining*.64,110*view.font/13);
      fitting.sort((a,b)=>Math.abs(a.width-target)-Math.abs(b.width-target));
      const choice=fitting[Math.floor(random()*Math.min(fitting.length, 10))];
      taken+=choice.width+(selected.length?gapMin:0);
      selected.push(choice);
      if(available-taken<small+gapMin) break;
    }
    if(!selected.length) continue;
    const extra=(available-taken)/Math.max(1,selected.length-1);
    const score=available-taken + Math.max(0,extra-view.font*.95)*5;
    candidates.push({selected,taken,score});
  }
  if(!candidates.length) return [];
  candidates.sort((a,b)=>a.score-b.score);
  const selected=candidates[0].selected;
  const sum=selected.reduce((s,p)=>s+p.width,0);
  const spread=selected.length>1 ? (available-sum)/(selected.length-1):0;
  let x=selected.length===1 ? left+(available-sum)/2 : left;
  const out=[];
  for(let i=0;i<selected.length;i++) {
    const phrase=selected[i];
    out.push({ text:phrase.text, x, y, width:phrase.width,
      row, section, edge:i===0||i===selected.length-1 });
    x+=phrase.width+spread;
  }
  return out;
}

function setup() {
  const width=window.innerWidth, height=window.innerHeight;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(width*dpr);
  canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const portrait=height>width;
  const heartWidth=Math.min(width*(portrait?.92:.82),height*(portrait?.78:.84)*1.12);
  const heartHeight=heartWidth/1.14;
  const scaleX=heartWidth/2.14;
  const scaleY=heartHeight/2.13;
  const cx=width/2, cy=height*.47;
  const font=Math.max(10,Math.min(14.5,heartHeight/36));
  const lineHeight=font*1.44;
  view={width,height,font};
  ctx.font=`600 ${font}px Arial, sans-serif`;
  const path=heartPath().map(p=>({x:cx+p.x*scaleX,y:cy+p.y*scaleY}));
  const minY=Math.min(...path.map(p=>p.y));
  const maxY=Math.max(...path.map(p=>p.y));
  const options=WORDS.map(text=>({text,width:ctx.measureText(text).width}));
  const random=randomMaker(20261012);
  const placed=[];
  let row=0;
  for(let y=minY+font*1.08;y<maxY-font*.14;y+=lineHeight) {
    const ranges=clippedRanges(path,y,font);
    for(let section=0;section<ranges.length;section++) {
      const [l,r]=ranges[section];
      placed.push(...fillRow(l,r,y,options,random,row,section));
    }
    row++;
  }
  // A tiny final phrase makes a crisp point, instead of a flat cut-off bottom.
  const finalTip=placed.reduce((m,p)=>Math.max(m,p.y),-Infinity);
  if(Number.isFinite(finalTip) && maxY-finalTip>font*.9) {
    const tiny='♡';
    const old=ctx.font;
    ctx.font=`600 ${font*.75}px Arial, sans-serif`;
    const w=ctx.measureText(tiny).width;
    ctx.font=old;
    placed.push({text:tiny,width:w,x:cx-w/2,y:Math.min(maxY-2,finalTip+font*.86),row:row+1,edge:true,small:true});
  }

  for(const p of placed) {
    if(p.edge) {
      const fraction=nearestOutlineFraction(path,p.x+p.width/2,p.y-font*.43);
      p.delay=150+fraction*OUTLINE_DURATION;
    } else {
      const vertical=(p.y-minY)/(maxY-minY);
      const horizontal=(p.x-cx)/heartWidth;
      p.delay=FILL_BEGINS+vertical*FILL_DURATION+horizontal*220;
    }
  }
  words=placed;
  startTime=performance.now();
}

function frame(now) {
  const {width,height,font}=view;
  const elapsed=now-startTime;
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#ff7869';
  ctx.shadowColor='rgba(255,82,60,.26)';
  ctx.shadowBlur=1.6;
  ctx.textAlign='left';
  ctx.textBaseline='alphabetic';
  for(const p of words) {
    const alpha=Math.min(1,Math.max(0,(elapsed-p.delay)/PHRASE_FADE));
    if(alpha<=0) continue;
    ctx.globalAlpha=alpha;
    ctx.font=`600 ${p.small?font*.75:font}px Arial, sans-serif`;
    ctx.fillText(p.text,p.x,p.y);
  }
  ctx.globalAlpha=1;
  ctx.shadowBlur=0;
  requestAnimationFrame(frame);
}

function replay(resetMusic=true) {
  startTime=performance.now();
  if(resetMusic && !music.paused) music.currentTime=0;
}
function updateSound() {
  const playing=!music.paused;
  soundLabel.textContent=playing?'Pause':'Music';
  soundBtn.setAttribute('aria-label',playing?'Pause music':'Play music');
  if(playing) tapHint.hidden=true;
}
function playMusic() {
  if(soundUnavailable || userMuted) return;
  music.play().then(updateSound).catch(()=>{
    // The browser may need a user gesture before it can play audio.
    if(!soundUnavailable) tapHint.hidden=false;
  });
}
replayBtn.addEventListener('click',()=>replay());
canvas.addEventListener('click',()=>replay(false));
soundBtn.addEventListener('click',()=>{
  if(!music.paused) {
    userMuted=true;
    music.pause();
    tapHint.hidden=true;
  } else {
    userMuted=false;
    playMusic();
  }
});
music.addEventListener('play',updateSound);
music.addEventListener('pause',updateSound);
music.addEventListener('error',()=>{
  soundUnavailable=true;
  soundLabel.textContent='No MP3';
  soundBtn.title='Put your music file at assets/music.mp3';
  tapHint.hidden=true;
});
window.addEventListener('pointerdown',e=>{
  if(!userMuted && music.paused && e.target!==soundBtn && !soundBtn.contains(e.target)) playMusic();
},{passive:true});
let resizeTimer;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(setup,100);
});
setup();
requestAnimationFrame(frame);
