// Cards thrown from the player who played them toward the opponent's chest.
// Tween position + rotation over a short duration, then despawn.

import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";
import { Card3d } from "../scene/Card3d";
import { useFx } from "./store";

const FLIGHT_MS = 700;

export function CardFlights({
  selfSide,
  selfHandPivot,
  opponentChest,
  selfChest,
}: {
  selfSide: 0 | 1;
  selfHandPivot: [number, number, number];
  opponentChest: [number, number, number];
  selfChest: [number, number, number];
}) {
  const events = useFx((s) => s.events);
  const flights = events.filter((e) => e.kind === "play-card") as Array<
    Extract<ReturnType<typeof useFx.getState>["events"][number], { kind: "play-card" }>
  >;

  return (
    <>
      {flights.map((f) => {
        const fromSelf = f.side === selfSide;
        // Local player's card flies from their hand pivot up to opponent's chest.
        // Opponent's card flies from their (mirrored) hand to our chest.
        const start: [number, number, number] = fromSelf
          ? [selfHandPivot[0], selfHandPivot[1] + 1.5, selfHandPivot[2] - 0.5]
          : [-selfHandPivot[0], selfHandPivot[1] + 1.5, -selfHandPivot[2] + 0.5];
        const end: [number, number, number] = fromSelf ? opponentChest : selfChest;
        return <FlightCard key={f.id} cardId={f.cardId} start={start} end={end} t0={f.t0} fromSelf={fromSelf} />;
      })}
    </>
  );
}

function FlightCard({
  cardId,
  start,
  end,
  t0,
  fromSelf,
}: {
  cardId: number;
  start: [number, number, number];
  end: [number, number, number];
  t0: number;
  fromSelf: boolean;
}) {
  const ref = useRef<Group>(null);
  const [done, setDone] = useState(false);

  useFrame(() => {
    if (!ref.current) return;
    const now = performance.now();
    const t = Math.min(1, (now - t0) / FLIGHT_MS);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

    // Interpolate XYZ; arc upward in the middle for a "thrown" look.
    const arc = Math.sin(t * Math.PI) * 1.4;
    const x = lerp(start[0], end[0], ease);
    const y = lerp(start[1], end[1], ease) + arc;
    const z = lerp(start[2], end[2], ease);
    ref.current.position.set(x, y, z);
    // Spin around the local Y axis (and tilt toward the destination).
    ref.current.rotation.y = (fromSelf ? -1 : 1) * t * Math.PI * 2;
    ref.current.rotation.x = -t * 0.7;
    // Shrink as it lands so the impact reads.
    const s = 1.0 - 0.5 * Math.max(0, t - 0.6);
    ref.current.scale.setScalar(s * 0.85);

    if (t >= 1 && !done) setDone(true);
  });

  if (done) return null;
  return (
    <group ref={ref}>
      <Card3d
        cardId={cardId}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        playable={false}
        faceUp={true}
      />
    </group>
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
