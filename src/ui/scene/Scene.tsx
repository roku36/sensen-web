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

      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.0} />
      <hemisphereLight args={["#bcd0ff", "#3a2a55", 0.5]} />

      {/* Table — slim translucent slab over the shader background */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[14, 0.1, 12]} />
        <meshStandardMaterial color="#0d0d18" metalness={0.3} roughness={0.6} transparent opacity={0.85} />
      </mesh>

      <PlayerStation player={op} position={[0, 1.0, -3.5]} isSelf={false} />
      <PlayerStation player={me} position={[0, 1.0, 2.0]} isSelf={true} />

      {/* Energy orb sits to the right of the player station, raised so the
          glowing rim is visible against the table */}
      <CostMeter cost={me.cost} rate={me.costRate} position={[5.6, 1.4, 1.0]} />

      <Hand player={me} />

      <OrbitControls enableDamping enablePan={false} target={[0, 0, 0]} maxPolarAngle={Math.PI * 0.45} minDistance={6} maxDistance={14} />
    </>
  );
}
