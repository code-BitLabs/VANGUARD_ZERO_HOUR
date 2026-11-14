import React from 'react';
import { WeaponId } from '@/src/schemas/weapon.schema';

export function WeaponSilhouette({ weaponId, className = 'w-24 h-8' }: { weaponId: WeaponId; className?: string }) {
  return (
    <svg viewBox="0 0 120 40" fill="none" className={className} aria-hidden="true">
      {weaponId === 'assault_rifle' && (
        <path
          d="M8 22h16l4-5h34l4 3h32v3H76l-3 5h-8l-2-5H48l-3 11h-7l2-11H28l-5 8h-8l-7-9z"
          fill="currentColor"
        />
      )}
      {weaponId === 'smg' && (
        <path
          d="M14 20h18l3-4h26l2 2h32v4H63l-3 11h-6l2-11H44l-3 10h-6l2-10H22l-4 6h-6l2-8z"
          fill="currentColor"
        />
      )}
      {weaponId === 'sniper_rifle' && (
        <path
          d="M4 23h18l5-5h14l2-4h20l2 4h48v2.5H68l-2 4H50l-2 9h-6l1-9H26l-6 7H6l-2-7.5z"
          fill="currentColor"
        />
      )}
      {weaponId === 'shotgun' && (
        <path
          d="M8 23h18l5-4h28v-2h42v3H58l-2 4H46l-3 7h-6l2-7H28l-6 7H10l-2-8z"
          fill="currentColor"
        />
      )}
      {weaponId === 'lmg' && (
        <path
          d="M6 22h16l4-6h36l3 3h40v3H68l-3 3v9H48v-9H38l-3 8h-6l2-8H22l-5 7H8l-2-10z"
          fill="currentColor"
        />
      )}
      {weaponId === 'pistol' && (
        <path d="M36 14h42v6H56l-5 15h-9l4-15h-6l-4-6z" fill="currentColor" />
      )}
      {weaponId === 'rocket_launcher' && (
        <path
          d="M10 14h84l8-2v12l-8-2H64l-3 9h-7l2-9H38l-3 7h-6l2-7H10V14z"
          fill="currentColor"
        />
      )}
      {weaponId === 'guided_missile' && (
        <path
          d="M12 13h80l10-3v14l-10-3H68v7H56v-7H40l-4 9h-8l3-9H12V13z"
          fill="currentColor"
        />
      )}
      {weaponId === 'grenade_launcher' && (
        <path
          d="M10 22h18l5-6h12a9 9 0 0 1 18 0h34v5H62a9 9 0 0 1-16 4H34l-5 9h-7l2-9H10v-3z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
