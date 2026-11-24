// Haptics, the mouth in the bottom bar, and the pill's fall. Pure presentation:
// the dose is already saved before any of this runs.

// ---- Haptics
// Android: Vibration API. iPhone: Safari has no Vibration API, but iOS 18+ plays a
// system tick when a native switch toggles, so a hidden <input switch> is flipped per tick.
const canVibrate = typeof navigator.vibrate === 'function';
const sw = document.createElement('label');
sw.setAttribute('aria-hidden', 'true');
sw.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
sw.innerHTML = '<input type="checkbox" switch tabindex="-1">';
document.body.append(sw);
const iosTick = () => sw.click();

export const haptic = {
  tick() { canVibrate ? navigator.vibrate(4) : iosTick(); },
  // The one strong, unmistakable signal, fired the instant the dose is saved.
  logged() { if (canVibrate) navigator.vibrate([35, 45, 35]); else { iosTick(); setTimeout(iosTick, 80); } },
  // Soft afterthought on landing so it never competes with "logged".
  gulp() { canVibrate ? navigator.vibrate(8) : iosTick(); },
  stop() { if (canVibrate) navigator.vibrate(0); },
};

// Ratchet: ticks that speed up as the sweep nears the pill, matching its ease-in.
// Times are from hold start; the first 120ms stay silent so a quick tap is silent.
const RATCHET_MS = [120, 340, 500, 620, 700, 760, 820];
export function startRatchet() {
  const ids = RATCHET_MS.map((t) => setTimeout(haptic.tick, t));
  return () => { ids.forEach(clearTimeout); haptic.stop(); };
}

// ---- Mouth: open amount a in [0,1] reshapes both lips
const $ = (id) => document.getElementById(id);
function setMouth(a) {
  const up = 32 - 30 * a, down = 32 + 34 * a, w = 14 - 6 * a;
  const d = `M${w} 32 Q60 ${up} ${120 - w} 32 Q60 ${down} ${w} 32 Z`;
  $('lips').setAttribute('d', d);
  $('clipPath').setAttribute('d', d);
  $('lipsLine').setAttribute('d', a < 0.02 ? `M${w} 32 Q60 36 ${120 - w} 32` : '');
  $('tongue').style.opacity = Math.min(1, a * 2);
}
setMouth(0);

function animateMouth(from, to, ms, ease = (t) => 1 - Math.pow(1 - t, 3)) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (t) => {
      const k = ms ? Math.min(1, (t - t0) / ms) : 1;
      setMouth(from + (to - from) * ease(k));
      k < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = Promise.resolve();

// Knock the capsule out of `iconEl`, drop it into the mouth. Calls are serialized.
export function dropPill(iconEl, capsuleSVG) {
  busy = busy.then(() => fall(iconEl, capsuleSVG)).catch(() => {});
  return busy;
}

async function fall(iconEl, capsuleSVG) {
  const src = iconEl.getBoundingClientRect();
  iconEl.classList.add('gone');
  const fly = document.createElement('div');
  fly.className = 'flyer';
  fly.innerHTML = capsuleSVG;
  document.body.append(fly);

  const slot = $('slot');
  const m = $('mouth').getBoundingClientRect();
  const x0 = src.left + src.width / 2, y0 = src.top + src.height / 2;
  const my = m.top + m.height / 2;
  // Keep the mouth fully on screen and aim the fall where it can actually be.
  const half = m.width / 2 + 8;
  const tx = Math.min(innerWidth - half, Math.max(half, x0));
  const dx = tx - (m.left + m.width / 2);
  // Closed-form ballistic path: a small pop up from the knock, then gravity.
  const G = 3200, vy = -240, vr = 540;                     // px/s², px/s, deg/s
  const tLand = (-vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, my - y0))) / G;
  const vx = (tx - x0) / tLand;                            // exact, lands dead center

  if (!reduce()) {
    slot.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }],
      { duration: Math.min(360, tLand * 650), easing: 'cubic-bezier(.3,.9,.4,1)', fill: 'forwards' });
    let opened = false;
    const start = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = (now - start) / 1000;
        const x = x0 + vx * t, y = y0 + vy * t + 0.5 * G * t * t;
        if (!opened && tLand - t < 0.2) { opened = true; animateMouth(0, 1, 150); }
        const sink = Math.max(0, Math.min(1, (y - (my - 12)) / 22));
        fly.style.transform = `translate(${x - 15}px, ${y - 15}px) rotate(${-35 + vr * t}deg) scale(${1 - sink * 0.65})`;
        fly.style.opacity = 1 - sink;
        sink >= 1 || t > 3 ? done() : requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  fly.remove();
  const bar = $('bar');
  bar.classList.remove('gulp'); void bar.offsetWidth; bar.classList.add('gulp');
  haptic.gulp();
  if (!reduce()) {
    await animateMouth(1, 0, 200, (t) => t * t);
    await sleep(120);
    await slot.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }],
      { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished;
  }
}
