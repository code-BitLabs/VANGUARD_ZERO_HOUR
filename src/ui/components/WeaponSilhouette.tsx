import React from 'react';
import { WeaponId } from '@/src/schemas/weapon.schema';

export function WeaponSilhouette({
  weaponId,
  className = 'w-28 h-8 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.35)]',
}: {
  weaponId: WeaponId;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 132 42"
      fill="none"
      className={className}
      aria-hidden="true"
      data-testid={`weapon-silhouette-${weaponId}`}
    >
      {weaponId === 'assault_rifle' && (
        <g>
          {/* M4A1 VANGUARD — buttstock, upper/lower receiver, EOTech holo, quad rail, curved PMAG, flash hider */}
          <path
            d="M6 21h18l4-5h14v-4h14v4h30l3 2h28v3H89l-3 3H70l-2 4h-7l-2-4H54l-4 13h-8l3-13H31l-5 9h-7l2-9H18l-4 6H6v-9z"
            fill="currentColor"
          />
          <rect x="44" y="13.5" width="10" height="2" rx="0.5" fill="rgba(11,14,17,0.75)" />
          <rect x="62" y="21" width="18" height="1.5" rx="0.5" fill="rgba(11,14,17,0.7)" />
          <rect x="117" y="21.5" width="7" height="2" rx="0.5" fill="currentColor" />
        </g>
      )}
      {weaponId === 'smg' && (
        <g>
          {/*KX-9 VECTOR — skeleton folding stock, KRISS downward recoil block, micro reflex, suppressor */}
          <path
            d="M12 20h18l3-4h12v-3.5h9V16h20l2 2h36v5H76l-2 11h-6l2-11H54l-3 12h-7l2-12H33l-5 8h-6l2-8H12v-3z"
            fill="currentColor"
          />
          <rect x="16" y="21.2" width="11" height="1.8" fill="rgba(11,14,17,0.75)" />
          <rect x="82" y="19.5" width="24" height="2" fill="rgba(11,14,17,0.5)" />
        </g>
      )}
      {weaponId === 'sniper_rifle' && (
        <g>
          {/* SR-50 INTERCEPTOR — cheek-riser stock, 6x scope with sunshade, fluted barrel, muzzle brake, bipod */}
          <path
            d="M4 22h20l5-4h14l2-5.5h28l2 5.5h44v2.5H88l4 7h-3l-4-7H72l-2 4H56l-2 9h-8l1-9H31l-6 8H6l-2-10.5z"
            fill="currentColor"
          />
          <rect x="46" y="14" width="22" height="2.2" fill="rgba(11,14,17,0.7)" />
          <rect x="119" y="20.5" width="8" height="5" rx="0.5" fill="currentColor" />
        </g>
      )}
      {weaponId === 'shotgun' && (
        <g>
          {/* M870 BREACHER — tactical stock, top shell saddle, ribbed pump forend, dual barrel + mag tube */}
          <path
            d="M8 22h18l5-4h32v-2h48v2.5H68v2h38v2.5H68l-2 3.5H48l-3 8h-7l2-8H29l-6 8H10l-2-10.5z"
            fill="currentColor"
          />
          <rect x="38" y="16.5" width="16" height="1.5" fill="rgba(11,14,17,0.75)" />
          <rect x="70" y="22.5" width="18" height="2" fill="rgba(11,14,17,0.7)" />
        </g>
      )}
      {weaponId === 'lmg' && (
        <g>
          {/* M249 SAW — heavy buffer stock, top feed cover, ventilated heat shield, 100rd box mag, bipod */}
          <path
            d="M6 21h18l4-5h40l3 3h42v3.5H86l4 7h-3l-4-7H72l-2 3v10H50v-10H39l-3 9h-7l2-9H22l-5 8H8l-2-10.5z"
            fill="currentColor"
          />
          <rect x="54" y="26" width="12" height="6" fill="rgba(11,14,17,0.45)" />
          <rect x="72" y="20" width="24" height="1.5" fill="rgba(11,14,17,0.75)" />
        </g>
      )}
      {weaponId === 'pistol' && (
        <g>
          {/* P226 TACTICAL — serrated slide, RMR sight, picatinny dust cover, ergonomic grip, suppressor */}
          <path
            d="M32 15h12v-2.5h7V15h34v3h22v4H85v2H60l-6 14h-11l5-14h-8l-4-4v-5z"
            fill="currentColor"
          />
          <rect x="58" y="21" width="6" height="3" rx="1" fill="rgba(11,14,17,0.8)" />
        </g>
      )}
      {weaponId === 'rocket_launcher' && (
        <g>
          {/* RPG-7V TACTICAL — flared exhaust venturi, launch tube, PGO-7 optic, PG-7V conical warhead */}
          <path
            d="M6 15l8 2h34v-4h10v4h34l14-4 16 5.5-16 5.5-14-4H64l-3 10h-7l2-10H40l-3 9h-7l2-9H14l-8 2V15z"
            fill="currentColor"
          />
          <circle cx="102" cy="18.5" r="2" fill="rgba(11,14,17,0.75)" />
        </g>
      )}
      {weaponId === 'guided_missile' && (
        <g>
          {/* FIM-92X JAVELIN — oversized launch tube, end-caps, CLU thermal seeker unit, twin grips */}
          <path
            d="M10 12h6v2h82v-2h8v12h-8v-2H72v10H52V22H38l-4 9h-7l3-9H16v2h-6V12z"
            fill="currentColor"
          />
          <rect x="56" y="24" width="12" height="5" rx="1" fill="rgba(11,14,17,0.7)" />
        </g>
      )}
      {weaponId === 'grenade_launcher' && (
        <g>
          {/* M32A1 ROTARY — collapsible stock, 6-chamber revolving cylinder, quadrant sight, vertical foregrip */}
          <path
            d="M8 21h18l5-5h12a10 10 0 0 1 20 0h38v4.5H82v8h-6v-8H63a10 10 0 0 1-18 4H34l-5 10h-7l2-10H8V21z"
            fill="currentColor"
          />
          <circle cx="53" cy="21" r="5" fill="rgba(11,14,17,0.65)" />
          <circle cx="53" cy="21" r="2" fill="currentColor" />
        </g>
      )}
    </svg>
  );
}

