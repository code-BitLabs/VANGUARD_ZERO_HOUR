export interface RankInfo {
  level: number;
  title: string;
  insignia: string;
  minXp: number;
}

export const RANKS: RankInfo[] = [
  { level: 1, title: 'Private', insignia: 'E-1', minXp: 0 },
  { level: 2, title: 'Corporal', insignia: 'E-4', minXp: 500 },
  { level: 3, title: 'Sergeant', insignia: 'E-5', minXp: 1200 },
  { level: 4, title: 'Staff Sergeant', insignia: 'E-6', minXp: 2200 },
  { level: 5, title: 'Lieutenant', insignia: 'O-1', minXp: 3600 },
  { level: 6, title: 'Captain', insignia: 'O-3', minXp: 5400 },
  { level: 7, title: 'Major', insignia: 'O-4', minXp: 7800 },
  { level: 8, title: 'Colonel', insignia: 'O-6', minXp: 11000 },
  { level: 9, title: 'Brigadier General', insignia: 'O-7', minXp: 15000 },
  { level: 10, title: 'Commander', insignia: 'O-10', minXp: 20000 },
];

export function getRankForXp(xp: number): { current: RankInfo; next: RankInfo | null; progressPct: number } {
  let current = RANKS[0];
  let next: RankInfo | null = RANKS[1];
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].minXp) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
    }
  }
  if (!next) return { current, next: null, progressPct: 100 };
  const span = next.minXp - current.minXp;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((xp - current.minXp) / span) * 100)) : 100;
  return { current, next, progressPct: pct };
}

export const ACHIEVEMENT_DEFINITIONS = [
  { id: 'first_blood', title: 'First Strike', description: 'Complete any campaign operation.' },
  { id: 'sharpshooter', title: 'Deadeye Operator', description: 'Score 5 or more headshots in a single mission.' },
  { id: 'sky_sweeper', title: 'Sky Sweeper', description: 'Shoot down 3 or more aerial threats in one operation.' },
  { id: 'convoy_buster', title: 'Road Fury', description: 'Destroy the armored convoy in Operation Red Dust.' },
  { id: 's_rank_elite', title: 'Vanguard Elite', description: 'Earn an S-Rank rating on any campaign mission.' },
  { id: 'veteran_cleared', title: 'Zero Hour Complete', description: 'Complete all 5 operations in the campaign.' },
  { id: 'tactical_specialist', title: 'Tactical Specialist', description: 'Complete an optional tactical objective during an operation.' },
  { id: 'challenge_master', title: 'Field Commendation', description: 'Complete 3 or more mission tactical challenges.' },
  { id: 'iron_vanguard', title: 'Iron Vanguard', description: 'Finish any operation with a Replay Modifier enabled.' },
  { id: 'weapon_master', title: 'Master Armorer', description: 'Reach Silver Mastery (25+ kills) with any primary weapon.' },
] as const;
