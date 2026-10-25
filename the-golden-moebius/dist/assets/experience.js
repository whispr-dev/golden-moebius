'use strict';
document.querySelectorAll('[data-fullscreen]').forEach(button=>button.addEventListener('click',async()=>{
  const target=document.getElementById(button.dataset.fullscreen);
  try { if(document.fullscreenElement)await document.exitFullscreen();else await target.requestFullscreen(); }
  catch { document.getElementById('frame-status').textContent='Fullscreen is unavailable here. Use “Open original view” for more space.'; }
}));

const bankFrame=document.querySelector('.experience-frame.bank iframe');
if(bankFrame)window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==bankFrame.contentWindow)return;
  if(event.data?.type==='golden-bank-done'){if(document.fullscreenElement===bankFrame.parentElement)void document.exitFullscreen().catch(()=>{});return;}
  if(event.data?.type!=='golden-bank-height')return;
  const height=event.data.height;
  if(Number.isFinite(height)&&height>=350&&height<=6000)bankFrame.style.height=Math.ceil(height)+'px';
});
