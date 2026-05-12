import { OrbitControls } from "@react-three/drei";
import { useStore } from "../store";
import { Hand } from "./Hand";
import { PlayerStation } from "./PlayerStation";

export function Scene() {
  const game = useStore((s) => s.game);
  const localPlayer = useStore((s) => s.localPlayer);
  const remotePlayer = (localPlayer ^ 1) as 0 | 1;
  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[remotePlayer];

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />
      <hemisphereLight args={["#666688", "#222244", 0.4]} />
      {/* Table */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[14, 0.1, 12]} />
        <meshStandardMaterial color="#1a1a22" />
      </mesh>
      <PlayerStation player={op} position={[0, 1.0, -3.5]} isSelf={false} />
      <PlayerStation player={me} position={[0, 1.0, 2.0]} isSelf={true} />
      <Hand player={me} />
      <OrbitControls enableDamping enablePan={false} target={[0, 0, 0]} />
    </>
  );
}
