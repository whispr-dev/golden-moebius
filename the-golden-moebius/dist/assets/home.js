'use strict';
(() => {
  const canvas = document.getElementById('paper-strip');
  const ctx = canvas.getContext('2d');
  const button = document.getElementById('trace-edge');
  const caption = document.getElementById('trace-caption');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animation = 0;
  let tracing = false;
  const tau = Math.PI * 2;
  function point(u, v) {
    const r = 1 + v * Math.cos(u / 2);
    return [r * Math.cos(u), r * Math.sin(u), v * Math.sin(u / 2)];
  }
  function project(p) {
    const [x,y,z] = p;
    const a = .58, tilt = .64;
    const horizontal = x*Math.cos(a)+y*Math.sin(a);
    const away = -x*Math.sin(a)+y*Math.cos(a);
    return [340+horizontal*181,213-(z*Math.cos(tilt)-away*Math.sin(tilt))*181,away*Math.cos(tilt)+z*Math.sin(tilt)];
  }
  const cells=[];
  for(let i=0;i<100;i++)for(let j=0;j<12;j++) {
    const u=i/100*tau, du=tau/100, v=-.44+j/12*.88, dv=.88/12;
    const points=[point(u,v),point(u+du,v),point(u+du,v+dv),point(u,v+dv)];
    const a=points[1].map((n,k)=>n-points[0][k]), b=points[3].map((n,k)=>n-points[0][k]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const length=Math.hypot(...n);
    const light=Math.abs((n[0]*.24+n[1]*.4+n[2]*.88)/length);
    const shade=.38+.62*light;
    const colour=`rgb(${Math.round(137+shade*84)},${Math.round(100+shade*80)},${Math.round(44+shade*68)})`;
    const projected=points.map(project);
    cells.push({points:projected,depth:projected.reduce((s,p)=>s+p[2],0)/4,colour});
  }
  cells.sort((a,b)=>a.depth-b.depth);
  function edgePath(fraction,colour,width) {
    if(fraction<=0)return;
    ctx.beginPath();
    const count=Math.max(1,Math.ceil(1000*fraction));
    for(let i=0;i<=count;i++){
      const p=project(point(i/count*fraction*tau*2,.44));
      if(i===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);
    }
    ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.lineJoin='round';ctx.stroke();
  }
  function draw(fraction=0) {
    ctx.clearRect(0,0,680,440);
    for(const cell of cells){ctx.beginPath();cell.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=cell.colour;ctx.fill();ctx.strokeStyle=cell.colour;ctx.lineWidth=.7;ctx.stroke();}
    edgePath(1,'#715a3140',1);
    if(fraction>0){
      edgePath(fraction,'#304f3c',2.5);
      const p=project(point(fraction*tau*2,.44));
      ctx.beginPath();ctx.arc(p[0],p[1],6,0,tau);ctx.fillStyle='#f4e6b9';ctx.fill();ctx.lineWidth=2.3;ctx.strokeStyle='#294c37';ctx.stroke();
    }
  }
  draw();
  button.addEventListener('click',()=>{
    if(tracing){cancelAnimationFrame(animation);tracing=false;draw();button.firstChild.textContent='Trace the single edge ';caption.textContent='One continuous journey. No jumping between edges.';return;}
    if(reduced){draw(1);caption.textContent='One continuous boundary: the full route is shown in green.';return;}
    tracing=true;button.firstChild.textContent='Stop tracing ';caption.textContent='Follow the green dot. It stays on the same boundary.';
    const start=performance.now();
    const frame=now=>{
      const fraction=Math.min(1,(now-start)/11000);draw(fraction);
      if(fraction<1)animation=requestAnimationFrame(frame);
      else {tracing=false;button.firstChild.textContent='Trace it again ';caption.textContent='Back to the beginning. One continuous edge, all the way round.';}
    };
    animation=requestAnimationFrame(frame);
  });
  document.querySelectorAll('.source-ref, a[href="#credits"]').forEach(link=>link.addEventListener('click',()=>{
    const target=document.getElementById(link.hash.slice(1));
    const detail=target?.closest('details');if(detail)detail.open=true;
  }));
})();
