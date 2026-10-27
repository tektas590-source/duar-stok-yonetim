import React, { useEffect, useRef, useState } from "react";

// three.js çalışma anında CDN'den yüklenir; paket kurulumu veya derleme bağımlılığı gerektirmez.
// Yüklenemezse (çevrimdışı vb.) sahne sessizce CSS arka planına düşer ve uygulama etkilenmez.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
let threePromise = null;
export function loadThree() {
  if (!threePromise) threePromise = import(/* @vite-ignore */ THREE_URL).catch((error) => { threePromise = null; throw error; });
  return threePromise;
}

// Stüdyo ortam ışığı: beyaz + indigo + gökyüzü mavisi panellerden oluşan bir
// "softbox" sahnesi, PMREM ile yansıma haritasına dönüştürülür. Kurumsal/
// yazılım ürünü hissi veren nötr, temiz bir aydınlatma sağlar.
export function buildEnvironment(THREE, renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const panel = (color, intensity, width, height, position, lookAt = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    mesh.position.set(...position);
    mesh.lookAt(...lookAt);
    scene.add(mesh);
  };
  panel(0xffffff, 7, 14, 2.5, [0, 7, 0]);
  panel(0x6366f1, 4, 1.5, 6, [-8, 2, 3]);
  panel(0x0ea5e9, 4, 1.5, 6, [8, 2, -3]);
  panel(0xffffff, 3, 10, 1.5, [0, 3, 9]);
  panel(0xffffff, 2.2, 10, 1.5, [0, 3, -9]);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.04);
  generator.dispose();
  return target.texture;
}

// "Bağlı sistem" sahnesi: parlak bir merkez çekirdek (platform) etrafında,
// farklı açılarda eğilmiş üç yörünge halkası döner; her halkada küçük
// düğümler (parça/iş emri/fatura gibi veri birimlerini simgeler) kendi
// hızlarında dolanır ve ince bir çizgiyle çekirdeğe bağlı kalır. Dişli/motor
// imgesinden bilinçli olarak uzaklaşıp, kurumsal bir yazılım platformunun
// "her şey birbirine bağlı, her şey görünür" hissini verir.
export function buildOrbitHub(THREE) {
  const group = new THREE.Group();

  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x6366f1, metalness: 0.35, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: 0x312e81, emissiveIntensity: 0.4, envMapIntensity: 1.7,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), coreMaterial);
  group.add(core);

  const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, wireframe: true, transparent: true, opacity: 0.28 });
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.16, 1), wireMaterial);
  group.add(wire);

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })
  );
  group.add(coreGlow);

  const palette = [0x6366f1, 0x0ea5e9, 0x14b8a6, 0xf59e0b];
  const ringDefs = [
    { radius: 2.1, tiltX: 0.2, tiltZ: 0.04, color: 0x0ea5e9, nodes: 2, speed: 0.07 },
    { radius: 2.95, tiltX: -0.34, tiltZ: 0.24, color: 0x6366f1, nodes: 3, speed: 0.05 },
    { radius: 3.75, tiltX: 0.48, tiltZ: -0.18, color: 0x14b8a6, nodes: 2, speed: 0.035 },
  ];

  const rings = [];
  const spokes = [];
  ringDefs.forEach((def, ringIndex) => {
    const pivot = new THREE.Group();
    pivot.rotation.x = def.tiltX;
    pivot.rotation.z = def.tiltZ;
    group.add(pivot);

    const ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(def.radius, 0.012, 8, 128),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pivot.add(ringMesh);
    rings.push({ pivot, speed: def.speed });

    for (let n = 0; n < def.nodes; n += 1) {
      const spoke = new THREE.Group();
      pivot.add(spoke);
      const color = palette[(ringIndex + n) % palette.length];
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 20, 16),
        new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, emissive: color, emissiveIntensity: 0.45 })
      );
      node.position.set(def.radius, 0, 0);
      spoke.add(node);
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(def.radius, 0, 0)]);
      const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 }));
      spoke.add(line);
      spokes.push({ group: spoke, base: (n / def.nodes) * Math.PI * 2, speed: (0.22 + ringIndex * 0.05 + n * 0.04) * (n % 2 === 0 ? 1 : -1) });
    }
  });

  return {
    group, core, wire,
    update(time) {
      core.rotation.y = time * 0.09;
      core.rotation.x = Math.sin(time * 0.11) * 0.09;
      wire.rotation.copy(core.rotation);
      rings.forEach((ring) => { ring.pivot.rotation.y = time * ring.speed; });
      spokes.forEach((spoke) => { spoke.group.rotation.y = spoke.base + time * spoke.speed; });
    },
  };
}

export function CinematicCar({ variant = "hero", className = "", children = null }) {
  const containerRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};

    loadThree().then((THREE) => {
      if (disposed) return;
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch (error) { setFailed(true); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "car-canvas";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x05070d, 0.05);
      scene.environment = buildEnvironment(THREE, renderer);

      const camera = new THREE.PerspectiveCamera(variant === "login" ? 34 : 30, 1, 0.1, 60);
      const hub = buildOrbitHub(THREE);
      scene.add(hub.group);

      const key = new THREE.DirectionalLight(0xffffff, 2.1);
      key.position.set(-4, 7, 5);
      scene.add(key);
      const rimIndigo = new THREE.PointLight(0x6366f1, 50, 16);
      rimIndigo.position.set(-4.5, 1.6, -3.5);
      scene.add(rimIndigo);
      const rimSky = new THREE.PointLight(0x0ea5e9, 46, 16);
      rimSky.position.set(4.5, 1.4, 3.5);
      scene.add(rimSky);
      scene.add(new THREE.AmbientLight(0x3b3f5c, 0.6));

      let width = 1;
      let height = 1;
      const resize = () => {
        width = Math.max(container.clientWidth, 1);
        height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        if (variant === "login") {
          const wide = width >= 900;
          camera.setViewOffset(width, height, wide ? width * 0.22 : 0, wide ? 0 : height * 0.2, width, height);
        } else camera.clearViewOffset();
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let visible = true;
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
      intersection.observe(container);
      const clock = new THREE.Clock();
      const lookTarget = new THREE.Vector3(0, 0, 0);
      const render = () => {
        const time = reduced ? 2.2 : clock.getElapsedTime();
        const angle = 0.5 + time * 0.14;
        const radius = (variant === "login" ? 9.6 : 8.2) + Math.sin(time * 0.3) * 0.8;
        camera.position.set(Math.cos(angle) * radius, 1.1 + Math.sin(time * 0.24) * 0.6 + (variant === "login" ? 0.4 : 0), Math.sin(angle) * radius);
        camera.lookAt(lookTarget);
        hub.update(time);
        renderer.render(scene, camera);
      };
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (visible && !document.hidden) render();
      };
      render();
      setReady(true);
      if (!reduced) loop();

      cleanup = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        intersection.disconnect();
        scene.traverse((object) => {
          object.geometry?.dispose?.();
          const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
          materials.forEach((material) => material.dispose());
        });
        scene.environment?.dispose?.();
        renderer.dispose();
        renderer.domElement.remove();
      };
      if (disposed) cleanup();
    }).catch(() => { if (!disposed) setFailed(true); });

    return () => { disposed = true; cancelAnimationFrame(frame); cleanup(); };
  }, [variant]);

  return React.createElement("div", { className: `car-stage car-stage-${variant} ${ready ? "car-ready" : ""} ${failed ? "car-failed" : ""} ${className}`.trim(), ref: containerRef },
    React.createElement("div", { className: "car-vignette", "aria-hidden": "true" }),
    React.createElement("div", { className: "car-letterbox car-letterbox-top", "aria-hidden": "true" }),
    React.createElement("div", { className: "car-letterbox car-letterbox-bottom", "aria-hidden": "true" }),
    children
  );
}
