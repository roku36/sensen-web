import { OrbitControls } from "@react-three/drei";
import { Background } from "./Background";
import { Hand } from "./Hand";
import { PlayerStation } from "./PlayerStation";
import { CardFlights } from "../effects/CardFlight";
import { FxObserver } from "../effects/Observer";
import { HitWaves } from "../effects/HitWave";
import { PowerAuras } from "../effects/PowerAuras";
import { useStore } from "../store";

// Anchor positions used by the FX layer to know where each player "lives".
const SELF_CHEST: [number, number, number] = [0, 1.8, 2.5];
const OP_CHEST: [number, number, number] = [0, 2.4, -5.5];
const SELF_HAND_PIVOT: [number, number, number] = [0, 2.5, 5.0]; // top of fan

export function Scene() {
  const game = useStore((s) => s.game);
  const localPlayer = useStore((s) => s.localPlayer);
  const remotePlayer = (localPlayer ^ 1) as 0 | 1;
  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[remotePlayer];

  // Hit-wave positions per side (0/1) — depend on which side is "me".
  const hitPositions = {
    [localPlayer]: SELF_CHEST,
    [remotePlayer]: OP_CHEST,
  } as Record<0 | 1, [number, number, number]>;

  return (
    <>
      <FxObserver />
      <Background intensity={0.7} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 10, 5]} intensity={0.9} />
      <hemisphereLight args={["#bcd0ff", "#3a2a55", 0.5]} />

      {/* Table */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[14, 0.1, 12]} />
        <meshStandardMaterial color="#0d0d18" metalness={0.3} roughness={0.6} transparent opacity={0.85} />
      </mesh>

      <PlayerStation player={op} position={[0, 2.6, -5.5]} isSelf={false} side={remotePlayer} />
      <PlayerStation player={me} position={[0, 1.6, 2.5]} isSelf={true} side={localPlayer} />


      <Hand player={me} side="self" />
      <Hand player={op} side="opponent" />

      {/* Persistent-power particle auras */}
      <PowerAuras player={me} origin={[SELF_CHEST[0], SELF_CHEST[1] - 0.6, SELF_CHEST[2]]} seed={localPlayer * 1000} />
      <PowerAuras player={op} origin={[OP_CHEST[0], OP_CHEST[1] - 0.6, OP_CHEST[2]]} seed={remotePlayer * 1000} />

      {/* Hit shockwaves */}
      <HitWaves positions={hitPositions} selfSide={localPlayer} />

      {/* Card flight animations on play */}
      <CardFlights
        selfSide={localPlayer}
        selfHandPivot={SELF_HAND_PIVOT}
        opponentChest={OP_CHEST}
        selfChest={SELF_CHEST}
      />

      <OrbitControls
        enableDamping
        enablePan={false}
        target={[0, 1.2, 0]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={7}
        maxDistance={16}
      />
    </>
  );
}
