/* Amog Space Program — canvas renderer.
 * Surface camera (flat ground, sky fades to space) crossfades into an
 * orbital camera (whole planet, trajectory trail) as the rocket climbs.
 */
(function (root) {
  'use strict';
  var P = root.ASP.physics, G = root.ASP.game, C = P.C;

  var canvas, ctx, W = 0, H = 0, DPR = 1;
  var stars = [], clouds = [];
  var trail = [], lastTrailT = -1;

  function rand(seed) { // deterministic-ish tiny PRNG
    var s = seed;
    return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  function init(cv) {
    canvas = cv; ctx = cv.getContext('2d');
    var r = rand(42);
    for (var i = 0; i < 260; i++) {
      stars.push({ x: r(), y: r(), s: r() * 1.6 + 0.4, tw: r() });
    }
    var r2 = rand(7);
    for (var j = 0; j < 40; j++) {
      clouds.push({
        dr: (r2() - 0.5) * 60000,          // downrange, m
        alt: 1500 + r2() * 9000,           // m
        w: 300 + r2() * 900, o: 0.2 + r2() * 0.35
      });
    }
    resize();
    window.addEventListener('resize', resize);
    // layout changes that don't fire window.resize (mobile panel growth etc.)
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resize).observe(canvas);
    }
  }

  function resize() {
    if (!canvas) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    W = Math.max(rect.width, 1); H = Math.max(rect.height, 1);
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function skyColor(h) {
    // deep blue at ground -> black in space
    var f = Math.min(1, h / 90e3);
    var rr = Math.round(90 * (1 - f) * (1 - f));
    var gg = Math.round(150 * (1 - f) * (1 - f));
    var bb = Math.round(235 * (1 - f));
    return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
  }

  function drawStars(alpha, t) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.55 + 0.45 * Math.sin(t * 0.001 + s.tw * 40);
      ctx.globalAlpha = alpha * tw * 0.9;
      ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
    }
    ctx.restore();
  }

  // ---- Surface camera -------------------------------------------------------

  function drawSurface(f, t, alpha) {
    var h = Math.max(0, f.alt());
    var ang = Math.atan2(f.x, f.y);              // angle from launch site
    var downrange = ang * C.R_EARTH;             // m east
    var viewH = Math.max(260, h * 1.9 + 140);
    var scale = H / viewH;
    var camBottom = Math.max(-40, h - viewH * 0.72);
    function sy(a) { return H - (a - camBottom) * scale; }
    function sx(dr) { return W * 0.5 + (dr - downrange) * scale; }

    ctx.save();
    ctx.globalAlpha = alpha;

    // sky
    ctx.fillStyle = skyColor(h);
    ctx.fillRect(0, 0, W, H);
    drawStars(alpha * Math.max(0, Math.min(1, (h - 25e3) / 50e3)), t);

    // ground
    var gy = sy(0);
    if (gy < H + 200) {
      ctx.fillStyle = '#2c4a2e';
      ctx.fillRect(0, gy, W, Math.max(0, H - gy) + 200);
      ctx.strokeStyle = '#5a7d52';
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      // launch pad
      var px = sx(0);
      if (px > -80 && px < W + 80) {
        ctx.fillStyle = '#888';
        ctx.fillRect(px - 18 * Math.min(scale, 1) - 2, gy - 6, 36 * Math.min(scale, 1) + 4, 6);
        ctx.fillStyle = '#666';
        ctx.fillRect(px + 14, gy - 34, 4, 34); // tower
      }
    }

    // clouds
    ctx.fillStyle = '#fff';
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var cx = sx(cl.dr), cy = sy(cl.alt), cw = cl.w * scale;
      if (cw < 3 || cw > W * 0.45 || cx < -cw || cx > W + cw || cy < -60 || cy > H + 60) continue;
      ctx.globalAlpha = alpha * cl.o;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, cw * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;

    // rocket
    var rx = W * 0.5, ry = sy(h);
    var vAng = (f.speed() > 2)
      ? Math.atan2(f.vx * Math.cos(ang) - f.vy * Math.sin(ang), f.vy * Math.cos(ang) + f.vx * Math.sin(ang))
      : 0;
    drawRocket(rx, ry, vAng, f.thrusting, Math.max(10, Math.min(26, scale * 18)));

    ctx.restore();
  }

  function drawRocket(x, y, angle, flame, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // body
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.32, size * 0.5);
    ctx.lineTo(-size * 0.32, size * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c33';
    ctx.fillRect(-size * 0.32, size * 0.34, size * 0.64, size * 0.16);
    if (flame) {
      var fl = size * (1.1 + Math.random() * 0.5);
      var grd = ctx.createLinearGradient(0, size * 0.5, 0, size * 0.5 + fl);
      grd.addColorStop(0, 'rgba(255,240,160,0.95)');
      grd.addColorStop(0.5, 'rgba(255,140,40,0.8)');
      grd.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, size * 0.5);
      ctx.lineTo(size * 0.2, size * 0.5);
      ctx.lineTo(0, size * 0.5 + fl);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---- Orbital camera -------------------------------------------------------

  // At true scale, low orbit hugs the planet's rim (200 km on a 6371 km ball
  // is sub-pixel) and the rocket looks like it's INSIDE the planet. Exaggerate
  // altitude radially near the surface, tapering to true scale by a few
  // thousand km. Purely cosmetic — physics is untouched.
  function exagRadius(r) {
    var h = r - C.R_EARTH;
    if (h <= 0) return r;
    return C.R_EARTH + h * (1 + 5 * Math.exp(-h / 6e5));
  }
  function dispXY(wx, wy) {
    var r = Math.sqrt(wx * wx + wy * wy);
    if (r < 1) return [wx, wy];
    var k = exagRadius(r) / r;
    return [wx * k, wy * k];
  }

  function drawOrbital(f, t, alpha, idle) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, W, H);
    drawStars(alpha, t);

    var rTrue = idle ? C.R_EARTH + 600e3 : Math.sqrt(f.x * f.x + f.y * f.y);
    var rDisp = exagRadius(rTrue);
    var fit = Math.max(rDisp * 1.15, C.R_EARTH * 1.45);
    if (!idle && isFinite(f.apoapsis) && f.apoapsis > 0) {
      fit = Math.max(fit, exagRadius(C.R_EARTH + Math.min(f.apoapsis, 60000e3)) * 1.05);
    }
    var scale = Math.min(W, H) / (2 * fit);
    var cx = W / 2, cy = H / 2;
    function sX(wx) { return cx + wx * scale; }
    function sY(wy) { return cy - wy * scale; }

    // atmosphere glow, hugging the planet out to the (display-mapped) 140 km line
    var aR = exagRadius(C.R_EARTH + C.ATMO_TOP) * scale;
    var glow = ctx.createRadialGradient(cx, cy, C.R_EARTH * scale * 0.98, cx, cy, aR);
    glow.addColorStop(0, 'rgba(110,170,255,0.5)');
    glow.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, aR, 0, Math.PI * 2); ctx.fill();

    // Earth
    var eg = ctx.createRadialGradient(cx - C.R_EARTH * scale * 0.35, cy - C.R_EARTH * scale * 0.35,
      C.R_EARTH * scale * 0.2, cx, cy, C.R_EARTH * scale);
    eg.addColorStop(0, '#4d9fe0');
    eg.addColorStop(0.55, '#2b6cb0');
    eg.addColorStop(0.8, '#28825a');
    eg.addColorStop(1, '#14324e');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(cx, cy, C.R_EARTH * scale, 0, Math.PI * 2); ctx.fill();

    // Moon, if it fits
    var moonD = 384.4e6;
    if (moonD * scale < Math.min(W, H) * 0.7) {
      var mx = sX(moonD * 0.7071), my = sY(moonD * 0.7071);
      ctx.fillStyle = '#c9c9c9';
      ctx.beginPath(); ctx.arc(mx, my, Math.max(2, 1.737e6 * scale), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('Moon', mx + 6, my - 6);
    }

    if (idle) {
      // satellites of your constellation
      var n = Math.min(G.state.sats, 30);
      for (var i = 0; i < n; i++) {
        var oa = t * 0.00012 + i * (Math.PI * 2 / Math.max(n, 1));
        var orad = exagRadius(C.R_EARTH + 500e3 + (i % 5) * 260e3) * scale;
        ctx.fillStyle = '#ffd76e';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(oa) * orad, cy + Math.sin(oa) * orad, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (G.state.research.station) {
        var sa = t * 0.00009;
        var sr = exagRadius(C.R_EARTH + 420e3) * scale;
        ctx.fillStyle = '#9fe0ff';
        ctx.fillRect(cx + Math.cos(sa) * sr - 3, cy + Math.sin(sa) * sr - 1.5, 6, 3);
      }
      ctx.restore();
      return;
    }

    // trajectory trail
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(140,200,255,0.65)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      var p0 = dispXY(trail[0][0], trail[0][1]);
      ctx.moveTo(sX(p0[0]), sY(p0[1]));
      for (var k = 1; k < trail.length; k++) {
        var pk = dispXY(trail[k][0], trail[k][1]);
        ctx.lineTo(sX(pk[0]), sY(pk[1]));
      }
      ctx.stroke();
    }

    // rocket
    var rp = dispXY(f.x, f.y);
    var rxp = sX(rp[0]), ryp = sY(rp[1]);
    ctx.fillStyle = f.thrusting ? '#ffdf80' : '#fff';
    ctx.beginPath(); ctx.arc(rxp, ryp, 3.2, 0, Math.PI * 2); ctx.fill();
    if (f.thrusting) {
      ctx.strokeStyle = 'rgba(255,170,60,0.9)';
      var vn = f.speed() || 1;
      ctx.beginPath();
      ctx.moveTo(rxp, ryp);
      ctx.lineTo(rxp - (f.vx / vn) * 12, ryp + (f.vy / vn) * 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Main draw ------------------------------------------------------------

  function draw(tMs) {
    if (!ctx) return;
    var f = G.flight;
    if (!f) {
      trail.length = 0; lastTrailT = -1;
      drawOrbital(null, tMs, 1, true);
      return;
    }
    // record trail
    if (f.t - lastTrailT > 0.5) {
      trail.push([f.x, f.y]);
      lastTrailT = f.t;
      if (trail.length > 5000) trail.splice(0, 1000);
    }
    var h = f.alt();
    var blend = Math.max(0, Math.min(1, (h - 22e3) / 22e3)); // 22-44 km crossfade
    if (blend < 1) drawSurface(f, tMs, 1);
    if (blend > 0) drawOrbital(f, tMs, blend, false);
  }

  root.ASP.render = { init: init, draw: draw, resize: resize };
})(typeof window !== 'undefined' ? window : globalThis);
