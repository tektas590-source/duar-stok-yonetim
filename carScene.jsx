import React, { useEffect, useRef, useState } from "react";

// three.js çalışma anında CDN'den yüklenir; paket kurulumu veya derleme bağımlılığı gerektirmez.
// Yüklenemezse (çevrimdışı vb.) sahne sessizce CSS arka planına düşer ve uygulama etkilenmez.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
let threePromise = null;
function loadThree() {
  if (!threePromise) threePromise = import(/* @vite-ignore */ THREE_URL).catch((error) => { threePromise = null; throw error; });
  return threePromise;
}

function buildCar(THREE) {
  const car = new THREE.Group();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({ color: 0x24382d, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 3.2 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x03070a, metalness: 0.3, roughness: 0.05, clearcoat: 1, envMapIntensity: 2 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.6, roughness: 0.5 });

  const profile = new THREE.Shape();
  profile.moveTo(-2.05, 0.28);
  profile.lineTo(-2.16, 0.62);
  profile.quadraticCurveTo(-2.12, 0.86, -1.8, 0.9);
  profile.lineTo(-1.25, 0.96);
  profile.quadraticCurveTo(-0.95, 1.38, -0.6, 1.4);
  profile.lineTo(0.35, 1.4);
  profile.quadraticCurveTo(0.8, 1.36, 1.05, 0.98);
  profile.lineTo(1.85, 0.84);
  profile.quadraticCurveTo(2.2, 0.78, 2.2, 0.55);
  profile.lineTo(2.12, 0.28);
  profile.lineTo(-2.05, 0.28);
  const bodyGeometry = new THREE.ExtrudeGeometry(profile, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 6, curveSegments: 24 });
  bodyGeometry.translate(0, 0, -0.75);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  car.add(body);

  const glassShape = new THREE.Shape();
  glassShape.moveTo(-1.1, 1.02);
  glassShape.lineTo(-0.72, 1.3);
  glassShape.lineTo(0.3, 1.32);
  glassShape.lineTo(0.8, 1.02);
  glassShape.lineTo(-1.1, 1.02);
  const glassGeometry = new THREE.ExtrudeGeometry(glassShape, { depth: 1.82, bevelEnabled: false });
  glassGeometry.translate(0, 0, -0.91);
  car.add(new THREE.Mesh(glassGeometry, glassMaterial));

  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xe8fbff });
  const tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  [-1, 1].forEach((side) => {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.42), lightMaterial);
    head.position.set(2.24, 0.62, side * 0.55);
    car.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.42), tailMaterial);
    tail.position.set(-2.22, 0.66, side * 0.55);
    car.add(tail);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), bodyMaterial);
    mirror.position.set(0.95, 1.05, side * 0.98);
    car.add(mirror);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.55, 4, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.set(2.3 + 2, 0.55, side * 0.55);
    car.add(beam);
  });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.9), trimMaterial);
  grille.position.set(2.27, 0.48, 0);
  car.add(grille);
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.5), tailMaterial);
  tailBar.position.set(-2.24, 0.68, 0);
  car.add(tailBar);

  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.85 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d1cc, metalness: 1, roughness: 0.22 });
  const wheels = [];
  [[1.38, 1], [1.38, -1], [-1.38, 1], [-1.38, -1]].forEach(([x, side]) => {
    const wheel = new THREE.Group();
    const tireGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 40);
    tireGeometry.rotateX(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeometry, tireMaterial);
    tire.castShadow = true;
    wheel.add(tire);
    const faceGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.32, 32);
    faceGeometry.rotateX(Math.PI / 2);
    wheel.add(new THREE.Mesh(faceGeometry, rimMaterial));
    for (let index = 0; index < 5; index += 1) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), trimMaterial);
      spoke.rotation.z = (index * Math.PI) / 5;
      wheel.add(spoke);
    }
    wheel.position.set(x, 0.4, side * 0.86);
    car.add(wheel);
    wheels.push(wheel);
  });
  return { car, wheels };
}

function buildEnvironment(THREE, renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020403);
  const panel = (color, intensity, width, height, position, lookAt = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    mesh.position.set(...position);
    mesh.lookAt(...lookAt);
    scene.add(mesh);
  };
  panel(0xffffff, 9, 14, 2.5, [0, 7, 0]);
  panel(0xa8f045, 4, 1.5, 6, [-8, 2, 3]);
  panel(0x00e5ff, 4, 1.5, 6, [8, 2, -3]);
  panel(0xffffff, 4, 10, 1.5, [0, 3, 9]);
  panel(0xffffff, 3, 10, 1.5, [0, 3, -9]);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.04);
  generator.dispose();
  return target.texture;
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
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "car-canvas";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x040605, 0.055);
      scene.environment = buildEnvironment(THREE, renderer);

      const camera = new THREE.PerspectiveCamera(variant === "login" ? 34 : 30, 1, 0.1, 60);
      const { car, wheels } = buildCar(THREE);
      scene.add(car);

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.55 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const glowMaterial = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ringA = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.36, 96), glowMaterial(0xa8f045, 0.85));
      const ringB = new THREE.Mesh(new THREE.RingGeometry(4.4, 4.43, 96), glowMaterial(0x00e5ff, 0.45));
      const halo = new THREE.Mesh(new THREE.CircleGeometry(3.3, 96), glowMaterial(0xa8f045, 0.025));
      [ringA, ringB, halo].forEach((mesh) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.01; scene.add(mesh); });

      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-4, 8, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 24 });
      scene.add(key);
      const rimLime = new THREE.PointLight(0xa8f045, 60, 14);
      rimLime.position.set(-4.5, 1.6, -3.5);
      scene.add(rimLime);
      const rimCyan = new THREE.PointLight(0x00e5ff, 55, 14);
      rimCyan.position.set(4.5, 1.4, 3.5);
      scene.add(rimCyan);
      const underglow = new THREE.PointLight(0xa8f045, 8, 5);
      underglow.position.set(0, 0.12, 0);
      scene.add(underglow);

      let width = 1;
      let height = 1;
      const resize = () => {
        width = Math.max(container.clientWidth, 1);
        height = Math.max(container.clientHeight, 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        // Giriş ekranında araç geniş ekranda sola, dar ekranda yukarı kayar; kart önünde kalır.
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
      const lookTarget = new THREE.Vector3(0, 0.75, 0);
      const render = () => {
        const time = reduced ? 2.2 : clock.getElapsedTime();
        // Sinematik yörünge: yavaş dönüş, nefes alan mesafe ve yükseklik.
        const angle = 0.5 + time * 0.16;
        const radius = (variant === "login" ? 7.4 : 6.2) + Math.sin(time * 0.35) * 0.9;
        camera.position.set(Math.cos(angle) * radius, 1.3 + Math.sin(time * 0.27) * 0.45 + (variant === "login" ? 0.5 : 0), Math.sin(angle) * radius);
        camera.lookAt(lookTarget);
        wheels.forEach((wheel) => { wheel.rotation.z = -time * 3; });
        ringA.rotation.z = time * 0.15;
        ringB.rotation.z = -time * 0.1;
        ringA.material.opacity = 0.65 + Math.sin(time * 1.4) * 0.2;
        car.position.y = Math.sin(time * 1.8) * 0.006;
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
