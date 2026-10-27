import React, { useEffect, useRef, useState } from "react";
import { loadThree, buildEnvironment, buildOrbitHub } from "./carScene.jsx";

// Giriş ekranı için "bağlı sistem" sahnesi: kaydırdıkça kamera, merkez
// çekirdek etrafındaki yörünge halkaları arasında sinematik kesitler alır.
// three.js CDN'den yüklenir; yüklenemezse CSS arka plan kalır.
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
      renderer.toneMappingExposure = 1.1;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "car-canvas";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x05070d, 0.028);
      scene.environment = buildEnvironment(THREE, renderer);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);

      const hub = buildOrbitHub(THREE);
      scene.add(hub.group);

      scene.add(new THREE.AmbientLight(0x3b3f5c, 0.55));
      const key = new THREE.DirectionalLight(0xfaf7ff, 2.0);
      key.position.set(6, 8, 10);
      scene.add(key);
      const rimIndigo = new THREE.PointLight(0x6366f1, 90, 30);
      rimIndigo.position.set(-7, -1, -4);
      scene.add(rimIndigo);
      const rimSky = new THREE.PointLight(0x0ea5e9, 70, 30);
      rimSky.position.set(8, 4, 6);
      scene.add(rimSky);

      const resize = () => {
        const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.fov = width < 700 ? 44 : 32;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let visible = true;
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
      intersection.observe(container);
      const clock = new THREE.Clock();
      // Giriş hikâyesindeki 4 bölüme karşılık gelen kamera kesitleri.
      const shots = [
        { p: [2, 1.4, 10.5], t: [0, 0, 0] },
        { p: [-7.5, 2.4, 6.5], t: [0, 0.3, 0] },
        { p: [6.5, -2.2, 8], t: [0, -0.2, 0] },
        { p: [0.5, 4.2, 9], t: [0, 0.4, 0] },
      ];
      const lerp = (a, b, t) => a + (b - a) * t;
      const ease = (t) => t * t * (3 - 2 * t);
      const look = new THREE.Vector3();
      let mx = 0, my = 0, target = 0, smooth = 0, lastTime = 0;
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
        const f = smooth * (shots.length - 1), idx = Math.min(shots.length - 2, Math.floor(f)), t = ease(f - idx);
        const a = shots[idx], b = shots[idx + 1];
        camera.position.set(
          lerp(a.p[0], b.p[0], t) + Math.sin(time * 0.18) * 0.5 + mx * 0.7,
          lerp(a.p[1], b.p[1], t) + Math.sin(time * 0.22) * 0.3 - my * 0.5,
          lerp(a.p[2], b.p[2], t)
        );
        look.set(lerp(a.t[0], b.t[0], t), lerp(a.t[1], b.t[1], t), lerp(a.t[2], b.t[2], t));
        camera.lookAt(look);
        hub.update(time);
        rimIndigo.intensity = 80 + Math.sin(time * 1.6) * 20;
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
