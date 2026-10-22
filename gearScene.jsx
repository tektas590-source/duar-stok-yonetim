import React, { useEffect, useRef, useState } from "react";
import { loadThree } from "./carScene.jsx";

// Giriş ekranı için dişli, krank ve piston sahnesi. three.js CDN'den yüklenir; yüklenemezse CSS arka plan kalır.
function gearMesh(THREE, N, thick, holeR, material, spokes) {
  const m = 0.1, rp = N * m, ro = rp + m, rr = rp - 1.25 * m, step = Math.PI * 2 / N;
  const shape = new THREE.Shape();
  for (let i = 0; i < N; i++) {
    [[rr, -0.5], [ro, -0.22], [ro, 0.22], [rr, 0.5]].forEach((p, k) => {
      const a = i * step + p[1] * step * 0.5;
      const x = Math.cos(a) * p[0], y = Math.sin(a) * p[0];
      if (i === 0 && k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, holeR, 0, Math.PI * 2, true); shape.holes.push(hole);
  if (spokes) {
    const n = 6, inner = holeR * 1.9, outer = rr - 0.28;
    for (let j = 0; j < n; j++) {
      const c = (j + 0.5) * Math.PI * 2 / n, w = Math.PI / n * 0.62, p = new THREE.Path();
      p.absarc(0, 0, outer, c - w, c + w, false);
      p.absarc(0, 0, inner, c + w * 0.9, c - w * 0.9, true);
      p.closePath(); shape.holes.push(p);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 6 });
  geometry.translate(0, 0, -thick / 2);
  return new THREE.Mesh(geometry, material);
}

function buildEnvironment(THREE, renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: 0x14181e, side: THREE.BackSide })));
  const strip = (w, h, x, y, z, color, ry) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = ry || 0; env.add(mesh);
  };
  strip(18, 1.2, 0, 14, 4, 0xffffff, 0);
  strip(1.2, 16, -14, 2, 2, 0xcfe0ff, Math.PI / 2);
  strip(1.5, 12, 14, 0, -4, 0xff8a3a, Math.PI / 2);
  strip(14, 1, 0, -12, 6, 0x7a8696, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return texture;
}

export function GearScene({ variant = "login", children, className = "" }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let disposed = false, frame = 0, cleanup = () => {};

    loadThree().then((THREE) => {
      if (disposed) return;
      let renderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
      catch (error) { setFailed(true); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "car-canvas";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.environment = buildEnvironment(THREE, renderer);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);

      const steel = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, metalness: 1, roughness: 0.28 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x4a525c, metalness: 1, roughness: 0.4 });
      const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.6, roughness: 0.35, emissive: 0x5a1c00, emissiveIntensity: 0.8 });

      const rig = new THREE.Group(); scene.add(rig);
      const gA = gearMesh(THREE, 20, 0.5, 0.28, steel, true); gA.position.set(0, 0, 0);
      const gB = gearMesh(THREE, 12, 0.5, 0.2, accent, false); gB.position.set(3.2, 0, 0);
      const gC = gearMesh(THREE, 30, 0.5, 0.35, dark, true); gC.position.set(-5, 0, 0);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 24), steel); shaft.rotation.x = Math.PI / 2;
      const crankZ = -0.9, CR = 0.62, RL = 2.4;
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 20), accent); pin.rotation.x = Math.PI / 2;
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), steel);
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 32), steel);
      [0.25, 0.05].forEach((y) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 32), dark); ring.rotation.x = Math.PI / 2; ring.position.y = y; piston.add(ring); });
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 2.0, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a94a0, metalness: 1, roughness: 0.5, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 24), dark); crank.rotation.x = Math.PI / 2;
      crank.position.set(3.2, 0, crankZ);
      sleeve.position.set(3.2, 3.7, crankZ);
      rig.add(gA, gB, gC, shaft, pin, rod, piston, sleeve, crank);
      

      scene.add(new THREE.AmbientLight(0x404858, 0.5 * Math.PI));
      const key = new THREE.DirectionalLight(0xfff1e0, 2.2 * Math.PI); key.position.set(6, 8, 10); scene.add(key);
      const rimLime = new THREE.PointLight(0xff7a1a, 260, 40); rimLime.position.set(-6, -2, -4); scene.add(rimLime);
      const rimCool = new THREE.PointLight(0x9fc4ff, 60, 40); rimCool.position.set(8, 4, 6); scene.add(rimCool);

      const resize = () => {
        const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.fov = width < 700 ? 46 : 32;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let visible = true;
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
      intersection.observe(container);
      const clock = new THREE.Clock();
      const shots = [
        { p: [1.5, 1.2, 15], t: [-0.5, 0.2, 0], ex: 0 },
        { p: [-6, 3, 12], t: [-1, 0, 0], ex: 0.55 },
        { p: [9, 4.5, 8], t: [3.2, 1.6, -1], ex: 0.25 },
        { p: [0.5, -1, 17], t: [-0.8, 0.8, 0], ex: 0 },
      ];
      const lerp = (a, b, t) => a + (b - a) * t;
      const ease = (t) => t * t * (3 - 2 * t);
      const look = new THREE.Vector3();
      let mx = 0, my = 0, target = 0, smooth = 0, theta = 0, lastTime = 0;
      const onMove = (e) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      const render = () => {
        const time = reduced ? 2 : clock.getElapsedTime();
        const dt = Math.min(0.05, time - lastTime); lastTime = time;
        smooth += (target - smooth) * Math.min(1, dt * 4);
        if (!reduced) theta += dt * 0.55 + (target - smooth) * 3;
        const f = smooth * (shots.length - 1), idx = Math.min(shots.length - 2, Math.floor(f)), t = ease(f - idx);
        const a = shots[idx], b = shots[idx + 1], ex = lerp(a.ex, b.ex, t);
        camera.position.set(lerp(a.p[0], b.p[0], t) + Math.sin(time * 0.2) * 0.6 + mx * 0.8, lerp(a.p[1], b.p[1], t) + Math.sin(time * 0.27) * 0.3 - my * 0.6, lerp(a.p[2], b.p[2], t));
        look.set(lerp(a.t[0], b.t[0], t), lerp(a.t[1], b.t[1], t), lerp(a.t[2], b.t[2], t));
        camera.lookAt(look);
        // Kaydırdıkça parçalar birbirinden ayrılır.
        gA.position.set(0, 0, 1.6 * ex);
        gB.position.set(3.2 + 1.2 * ex * 0.35, 0.6 * ex, 3.2 * ex);
        gC.position.set(-5 - 2.2 * ex * 0.35, -0.4 * ex, 0.4 * ex);
        shaft.position.set(0, 0, -1.2 * ex);
        gA.rotation.z = theta;
        gB.rotation.z = 11 * Math.PI / 12 - theta * 20 / 12;
        gC.rotation.z = -Math.PI / 30 - theta * 20 / 30;
        const bx = gB.position.x, by = gB.position.y, bz = crankZ - 2.2 * ex;
        const px = bx + Math.cos(gB.rotation.z) * CR, py = by + Math.sin(gB.rotation.z) * CR;
        pin.position.set(px, py, bz);
        const dx = px - bx, top = py + Math.sqrt(Math.max(0.01, RL * RL - dx * dx));
        piston.position.set(bx, top + 0.45, bz);
        rod.position.set((px + bx) / 2, (py + top) / 2, bz);
        rod.scale.y = RL; rod.rotation.z = -Math.atan2(dx, top - py);
        sleeve.position.set(bx, by + 3.7, bz);
        crank.position.set(bx, by, bz);
        rimLime.intensity = 230 + Math.sin(time * 2) * 50;
        renderer.render(scene, camera);
      };
      const loop = () => { frame = requestAnimationFrame(loop); if (visible && !document.hidden) render(); };
      render(); setReady(true);
      if (!reduced) loop();

      cleanup = () => {
        cancelAnimationFrame(frame); window.removeEventListener("pointermove", onMove); window.removeEventListener("scroll", onScroll); resizeObserver.disconnect(); intersection.disconnect();
        scene.traverse((object) => {
          object.geometry?.dispose?.();
          (Array.isArray(object.material) ? object.material : object.material ? [object.material] : []).forEach((material) => material.dispose());
        });
        scene.environment?.dispose?.(); renderer.dispose(); renderer.domElement.remove();
      };
      if (disposed) cleanup();
    }).catch(() => { if (!disposed) setFailed(true); });

    return () => { disposed = true; cancelAnimationFrame(frame); cleanup(); };
  }, [variant]);

  return React.createElement("div", { className: `car-stage gear-stage car-stage-${variant} ${ready ? "car-ready" : ""} ${failed ? "car-failed" : ""} ${className}`.trim(), ref: containerRef },
    React.createElement("div", { className: "car-vignette", "aria-hidden": "true" }),
    React.createElement("div", { className: "car-letterbox car-letterbox-top", "aria-hidden": "true" }),
    React.createElement("div", { className: "car-letterbox car-letterbox-bottom", "aria-hidden": "true" }),
    children
  );
}
