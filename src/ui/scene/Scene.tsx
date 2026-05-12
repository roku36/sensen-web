import { OrbitControls } from "@react-three/drei";
import { Background } from "./Background";
import { CostMeter } from "./CostMeter";
import { Hand } from "./Hand";
import { PlayerStation } from "./PlayerStation";
import { useStore } from "../store";

export function Scene() {
  const game = useStore((s) => s.game);
  const localPlayer = useStore((s) => s.localPlayer);
  const remotePlayer = (localPlayer ^ 1) as 0 | 1;
  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[remotePlayer];

  return (
    <>
      <Background intensity={0.7} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 10, 5]} intensity={0.9} />
      <hemisphereLight args={["#bcd0ff", "#3a2a55", 0.5]} />

      {/* Table */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[14, 0.1, 12]} />
        <meshStandardMaterial color="#0d0d18" metalness={0.3} roughness={0.6} transparent opacity={0.85} />
      </mesh>

      <PlayerStation player={op} position={[0, 2.6, -5.5]} isSelf={false} />
      <PlayerStation player={me} position={[0, 1.6, 2.5]} isSelf={true} />

      {/* Cost orbs for both players. Self on the right, opponent on the left
          (mirrored) so the user can read both at a glance. */}
      <CostMeter cost={me.cost} rate={me.costRate} position={[5.6, 1.6, 2.0]} />
      <CostMeter cost={op.cost} rate={op.costRate} position={[-5.6, 2.6, -3.5]} />

      {/* Both hands. Opponent's is face-down (back-face shader); future camera
          lock will let only the back faces be visible. */}
      <Hand player={me} side="self" />
      <Hand player={op} side="opponent" />

      <OrbitControls enableDamping enablePan={false} target={[0, 1.2, 0]} maxPolarAngle={Math.PI * 0.49} minDistance={7} maxDistance={16} />
    </>
  );
}
