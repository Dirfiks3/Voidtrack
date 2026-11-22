import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { logEvent } from "../lib/errorLog";
import StaticWeek from "./StaticWeek";

export interface WeekObjectProps {
  week: boolean[];
  todayIndex: number;
  accent?: string;
  /** Увеличивается при каждой отметке — один короткий отклик объекта. */
  pulse?: number;
}

const TILE_WIDTH = 0.52;
const TILE_HEIGHT = 1.18;
const TILE_DEPTH = 0.12;
const SPACING = 0.68;
const RAIL_Y = -0.72;
const TILE_BASE_Y = RAIL_Y + 0.03 + TILE_HEIGHT / 2;
const DEFAULT_ACCENT = "#8ce8f7";

// На экранах с высоким DPI сглаживание даёт почти невидимый прирост качества,
// но заметно просаживает FPS. Один объект из семи плиток этого не оправдывает.
const MOBILE_DPR = typeof window !== "undefined" && window.devicePixelRatio > 1.5;
const IS_MOBILE = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const CANVAS_GL = {
  alpha: true,
  antialias: !IS_MOBILE && !MOBILE_DPR,
  stencil: false,
  powerPreference: "high-performance" as WebGLPowerPreference,
};

// На телефоне WebGL рисуется только по требованию: короткая серия кадров
// после отметки/наведения, дальше GPU простаивает.
function useDemandFrames(trigger: number | string) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!IS_MOBILE) return;
    let handle = 0;
    let left = 24;
    const tick = () => {
      invalidate();
      if (--left > 0) handle = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(handle);
  }, [trigger, invalidate]);
}

class WebGLBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    logEvent("error", "webgl", error.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useImpulse(pulse: number) {
  const value = useRef(0);
  const previous = useRef(pulse);

  useEffect(() => {
    if (previous.current === pulse) return;
    previous.current = pulse;
    value.current = 1;
  }, [pulse]);

  return value;
}

function makeTileGeometry() {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;
  const radius = 0.07;
  const shape = new THREE.Shape();

  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TILE_DEPTH,
    steps: 1,
    curveSegments: 5,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -TILE_DEPTH / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Держит всю неделю в кадре на любом размере окна. */
function Frame() {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);

  useEffect(() => {
    camera.zoom = Math.min(width / 6.2, height / 2.8);
    camera.updateProjectionMatrix();
  }, [camera, width, height]);

  return null;
}

interface TileProps {
  index: number;
  count: number;
  done: boolean;
  today: boolean;
  accent: string;
  geometry: THREE.ExtrudeGeometry;
  markerGeometry: THREE.BoxGeometry;
  impulse: { current: number };
  pulse: number;
}

function Tile({
  index,
  count,
  done,
  today,
  accent,
  geometry,
  markerGeometry,
  impulse,
  pulse,
}: TileProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useDemandFrames(pulse + (hovered ? 1 : 0));
  const center = (count - 1) / 2;
  const x = (index - center) * SPACING;
  const targetScale = done ? 1 : 0.74;
  const scale = useRef(targetScale);

  const tone = useMemo(
    () =>
      new THREE.Color("#252b2e")
        .lerp(new THREE.Color(accent), done ? 0.46 : today ? 0.18 : 0.05)
        .getStyle(),
    [accent, done, today],
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.84, metalness: 0.04 }),
    [tone],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    scale.current = THREE.MathUtils.damp(
      scale.current,
      targetScale + (hovered ? 0.03 : 0),
      9,
      delta,
    );
    node.scale.y = scale.current;
    node.position.y =
      TILE_BASE_Y + (scale.current - 1) * (TILE_HEIGHT / 2) + (hovered ? 0.1 : 0) + impulse.current * 0.05;
    node.rotation.y = THREE.MathUtils.damp(
      node.rotation.y,
      hovered ? (index - center) * 0.02 : 0,
      9,
      delta,
    );
  });

  return (
    <group
      ref={group}
      position={[x, TILE_BASE_Y, 0]}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh geometry={geometry} material={material} castShadow={!IS_MOBILE} />
      <mesh
        geometry={markerGeometry}
        position={[0, TILE_HEIGHT / 2 - 0.13, TILE_DEPTH / 2 + 0.012]}
      >
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={done ? 0.9 : today ? 0.45 : 0}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function WeekScene({ week, todayIndex, accent = DEFAULT_ACCENT, pulse = 0 }: WeekObjectProps) {
  const impulse = useImpulse(pulse);
  useDemandFrames(`${pulse}:${week.join("")}`);
  const tileGeometry = useMemo(makeTileGeometry, []);
  const markerGeometry = useMemo(() => new THREE.BoxGeometry(0.26, 0.028, 0.012), []);
  const railGeometry = useMemo(
    () => new THREE.BoxGeometry(week.length * SPACING + 0.2, 0.06, 0.28),
    [week.length],
  );

  useEffect(
    () => () => {
      tileGeometry.dispose();
      markerGeometry.dispose();
      railGeometry.dispose();
    },
    [tileGeometry, markerGeometry, railGeometry],
  );

  useFrame((_, delta) => {
    impulse.current = THREE.MathUtils.damp(impulse.current, 0, 5, delta);
  });

  const todayX = (todayIndex - (week.length - 1) / 2) * SPACING;

  return (
    <group>
      <ambientLight intensity={0.72} />
      <directionalLight
        position={[-3, 5, 4]}
        intensity={2.1}
        castShadow={!IS_MOBILE}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <directionalLight position={[3, 1, 2]} intensity={0.35} />

      <mesh geometry={railGeometry} position={[0, RAIL_Y, 0]} receiveShadow>
        <meshStandardMaterial color="#1a1f21" roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, RAIL_Y + 0.031, 0.14]}>
        <boxGeometry args={[week.length * SPACING + 0.2, 0.008, 0.008]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.08} />
      </mesh>

      {todayIndex >= 0 && todayIndex < week.length && (
        <mesh position={[todayX, RAIL_Y + 0.04, 0.15]}>
          <boxGeometry args={[TILE_WIDTH, 0.014, 0.012]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      )}

      {week.map((done, index) => (
        <Tile
          key={index}
          index={index}
          count={week.length}
          done={done}
          today={index === todayIndex}
          accent={accent}
          geometry={tileGeometry}
          markerGeometry={markerGeometry}
          impulse={impulse}
          pulse={pulse}
        />
      ))}

      {!IS_MOBILE && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, RAIL_Y - 0.05, 0]} receiveShadow>
          <planeGeometry args={[12, 6]} />
          <shadowMaterial transparent opacity={0.38} />
        </mesh>
      )}
    </group>
  );
}

export default function WeekObject({ week, todayIndex, accent, pulse }: WeekObjectProps) {
  const fallback = <StaticWeek week={week} todayIndex={todayIndex} />;

  // WebView иногда не сообщает размер контейнера при первом монтировании,
  // и r3f оставляет буфер 300×150. Один resize после вставки это исправляет.
  useEffect(() => {
    const notify = () => window.dispatchEvent(new Event("resize"));
    const frame = window.requestAnimationFrame(notify);
    const timer = window.setTimeout(notify, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="stage-canvas" aria-hidden>
      <WebGLBoundary fallback={fallback}>
        <Canvas
          orthographic
          shadows={!IS_MOBILE}
          frameloop={IS_MOBILE ? "demand" : "always"}
          style={{ width: "100%", height: "100%" }}
          camera={{ position: [0, 2.2, 6], zoom: 100, near: 0.1, far: 30 }}
          onCreated={({ camera }) => camera.lookAt(0, -0.2, 0)}
          dpr={IS_MOBILE || MOBILE_DPR ? 1 : [1, 1.5]}
          gl={CANVAS_GL}
        >
          <Frame />
          <WeekScene week={week} todayIndex={todayIndex} accent={accent} pulse={pulse} />
        </Canvas>
      </WebGLBoundary>
    </div>
  );
}
