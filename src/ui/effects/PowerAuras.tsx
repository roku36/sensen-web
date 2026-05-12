// Spawns particle auras on each player based on their active persistent powers.

import { PlayerState } from "../../sim/state";
import { Aura } from "./Aura";

export function PowerAuras({
  player,
  origin,
  seed,
}: {
  player: PlayerState;
  origin: [number, number, number]; // chest of this player
  seed: number;
}) {
  return (
    <>
      {player.combust && (
        <Aura
          origin={origin}
          count={120}
          radius={0.9}
          height={2.4}
          colorHi="#ff8a30"
          colorLo="#a01000"
          seed={seed + 1}
          size={28}
        />
      )}
      {player.brutality && (
        <Aura
          origin={origin}
          count={70}
          radius={0.6}
          height={1.8}
          colorHi="#ff3060"
          colorLo="#400010"
          seed={seed + 2}
          size={20}
        />
      )}
      {player.demonForm && (
        <Aura
          origin={origin}
          count={100}
          radius={1.0}
          height={2.2}
          colorHi="#c050ff"
          colorLo="#200030"
          seed={seed + 3}
          size={22}
        />
      )}
      {player.metallicize && (
        <Aura
          origin={origin}
          count={50}
          radius={1.1}
          height={1.2}
          colorHi="#80c0ff"
          colorLo="#102040"
          seed={seed + 4}
          size={16}
        />
      )}
      {player.barricade && (
        <Aura
          origin={origin}
          count={40}
          radius={1.3}
          height={0.6}
          colorHi="#80ffe0"
          colorLo="#103040"
          seed={seed + 5}
          size={14}
        />
      )}
    </>
  );
}
