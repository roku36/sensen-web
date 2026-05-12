// HP bar, block, thorns, cost rendered in 3D for one player. Mirrors the
// status panel from src/game/ui.rs.

import { Text } from "@react-three/drei";
import { useMemo } from "react";
import { PlayerState } from "../../sim/state";
import { HpBar3d } from "./HpBar3d";

export function PlayerStation({
  player,
  position,
  isSelf,
  side,
}: {
  player: PlayerState;
  position: [number, number, number];
  isSelf: boolean;
  side: 0 | 1;
}) {
  const status = useMemo(() => buildStatus(player), [player]);

  return (
    <group position={position}>
      <Text position={[0, 0.55, 0]} fontSize={0.3} color="white" outlineWidth={0.012} outlineColor="black" anchorX="center">
        {isSelf ? "YOU" : "OPPONENT"}
      </Text>

      <HpBar3d
        hp={player.hp}
        hpMax={player.hpMax}
        side={side}
        isSelf={isSelf}
        position={[0, 0, 0]}
      />

      <Text position={[-2.6, -0.4, 0]} fontSize={0.18} color="#7ab6ff" anchorX="left" outlineWidth={0.008} outlineColor="black">
        Block {Math.round(player.block)}
      </Text>
      <Text position={[-1.0, -0.4, 0]} fontSize={0.18} color="#ffaa66" anchorX="left" outlineWidth={0.008} outlineColor="black">
        Thorns {Math.round(player.thorns)}
      </Text>
      {/* cost is rendered as a 3D shader orb (CostMeter) for the local player */}
      {status && (
        <Text position={[0, -0.75, 0]} fontSize={0.13} color="#cccc88" anchorX="center" outlineWidth={0.006} outlineColor="black" maxWidth={6}>
          {status}
        </Text>
      )}
    </group>
  );
}

function buildStatus(p: PlayerState): string {
  const parts: string[] = [];
  if (p.strength !== 0) parts.push(`Str${p.strength > 0 ? "+" : ""}${p.strength.toFixed(0)}`);
  if (p.vulnerableSecs > 0) parts.push(`Vuln(${p.vulnerableSecs.toFixed(1)}s)`);
  if (p.weakSecs > 0) parts.push(`Weak(${p.weakSecs.toFixed(1)}s)`);
  if (p.accelRemaining > 0) parts.push(`Accel+${p.accelBonusRate.toFixed(1)}(${p.accelRemaining.toFixed(1)}s)`);
  if (p.rage && p.rage.remaining > 0) parts.push(`Rage(${p.rage.remaining.toFixed(1)}s)`);
  if (p.metallicize) parts.push(`Metal+${p.metallicize.blockPerSec}/s`);
  if (p.demonForm) parts.push(`Demon+${p.demonForm.strengthPerSec}str/s`);
  if (p.barricade) parts.push("Barricade");
  if (p.combust) parts.push(`Combust(${p.combust.selfPerSec}/${p.combust.enemyPerSec}/s)`);
  if (p.corruption) parts.push("Corrupt");
  if (p.brutality) parts.push(`Brutal(${p.brutality.selfPerSec}/s +${p.brutality.draw})`);
  if (p.darkEmbrace) parts.push(`DkEmb+${p.darkEmbrace.drawOnExhaust}`);
  if (p.evolve) parts.push(`Evolve+${p.evolve.drawOnStatus}`);
  if (p.feelNoPain) parts.push(`FNP+${p.feelNoPain.blockOnExhaust}`);
  if (p.fireBreathing) parts.push(`FBrea+${p.fireBreathing.damageOnStatusDraw}`);
  if (p.rupture) parts.push(`Rupt+${p.rupture.strengthOnSelfDmg}`);
  if (p.juggernaut) parts.push(`Jugg+${p.juggernaut.damageOnBlock}`);
  return parts.join(" | ");
}
