import { CampaignEventId, SquadRoleId } from '@/src/schemas/campaign.schema';

export type DialogueEventType =
  | 'mission_deploy'
  | 'campaign_consequence_ack'
  | 'order_ack'
  | 'enemy_spotted'
  | 'high_value_kill'
  | 'operator_downed'
  | 'medic_revive'
  | 'player_revive'
  | 'low_ammo_warn'
  | 'stage_advance'
  | 'extraction_live'
  | 'injury_return';

export type DialoguePriority = 'CRITICAL' | 'TACTICAL' | 'BANTER';

export interface OperatorVoiceProfile {
  readonly operatorId: string;
  readonly callsign: string;
  readonly role: SquadRoleId;
  readonly personalityTag: string;
  readonly briefingQuip: string;
  /** Distinct Web Audio procedural radio voice signature (Hz / contour) */
  readonly baseFreqHz: number;
  readonly secondFreqHz: number;
  readonly cadenceMs: number;
  readonly squelchToneHz: number;
}

export interface DialogueCueTemplate {
  readonly id: string;
  readonly event: DialogueEventType;
  readonly priority: DialoguePriority;
  readonly roleFilter?: SquadRoleId;
  readonly missionFilter?: number;
  readonly orderFilter?: string;
  readonly consequenceFilter?: CampaignEventId;
  readonly text: string;
}

export interface OperatorCommendation {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

/**
 * Flyweight immutable operator identity & Web Audio radio voice profiles (TRN-46).
 */
export const OPERATOR_VOICE_PROFILES: Readonly<Record<string, OperatorVoiceProfile>> =
  Object.freeze({
    vanguard_2: Object.freeze({
      operatorId: 'vanguard_2',
      callsign: 'Vanguard-2 "Reaper"',
      role: 'assault',
      personalityTag: 'Decisive Pointman',
      briefingQuip: 'Give me a breach angle and keep their heads down — I will clear the lane.',
      baseFreqHz: 540,
      secondFreqHz: 680,
      cadenceMs: 58,
      squelchToneHz: 1180,
    }),
    bulwark_3: Object.freeze({
      operatorId: 'bulwark_3',
      callsign: 'Bulwark-3 "Hammer"',
      role: 'support',
      personalityTag: 'Steadfast Heavy Gunner',
      briefingQuip: 'Two hundred rounds linked and ready. Call the sector and nobody peeks.',
      baseFreqHz: 390,
      secondFreqHz: 460,
      cadenceMs: 74,
      squelchToneHz: 940,
    }),
    specter_4: Object.freeze({
      operatorId: 'specter_4',
      callsign: 'Specter-4 "Ghost"',
      role: 'recon',
      personalityTag: 'Calm Overwatch Marksman',
      briefingQuip: 'High ground first, noise discipline always. I will mark every nest before we cross.',
      baseFreqHz: 620,
      secondFreqHz: 560,
      cadenceMs: 62,
      squelchToneHz: 1340,
    }),
    anvil_5: Object.freeze({
      operatorId: 'anvil_5',
      callsign: 'Anvil-5 "Sledge"',
      role: 'anti_armor',
      personalityTag: 'Dry-Humor Ordnance Vet',
      briefingQuip: 'Armor, gunships, bunkers — if it is bolted down, I brought the shaped charge for it.',
      baseFreqHz: 430,
      secondFreqHz: 510,
      cadenceMs: 68,
      squelchToneHz: 1020,
    }),
    lifeline_6: Object.freeze({
      operatorId: 'lifeline_6',
      callsign: 'Lifeline-6 "Doc"',
      role: 'medic',
      personalityTag: 'Composed Combat Triage',
      briefingQuip: 'Stay in cover when your armor cracks. Two trauma kits packed — nobody gets left behind.',
      baseFreqHz: 710,
      secondFreqHz: 840,
      cadenceMs: 54,
      squelchToneHz: 1460,
    }),
    overwatch_hq: Object.freeze({
      operatorId: 'overwatch_hq',
      callsign: 'OVERWATCH HQ',
      role: 'recon',
      personalityTag: 'Tactical Command Net',
      briefingQuip: 'Satellite net online. Fireteam Zero-Hour cleared for weapons free.',
      baseFreqHz: 490,
      secondFreqHz: 615,
      cadenceMs: 66,
      squelchToneHz: 1100,
    }),
  });

export function getOperatorVoiceProfile(operatorId: string, role?: SquadRoleId): OperatorVoiceProfile {
  if (OPERATOR_VOICE_PROFILES[operatorId]) {
    return OPERATOR_VOICE_PROFILES[operatorId];
  }
  const byRole = Object.values(OPERATOR_VOICE_PROFILES).find((p) => p.role === role);
  return byRole ?? OPERATOR_VOICE_PROFILES.overwatch_hq;
}

/**
 * Authored event-driven tactical dialogue bank (TRN-46).
 * Strictly reactive to real mission events, orders, injuries, and campaign history.
 */
export const SQUAD_DIALOGUE_CATALOG: readonly DialogueCueTemplate[] = Object.freeze([
  // --- MISSION OPENING DEPLOYMENT ---
  Object.freeze({
    id: 'dep_m1_assault',
    event: 'mission_deploy',
    priority: 'BANTER',
    missionFilter: 1,
    roleFilter: 'assault',
    text: 'Boots on the boulevard. Two AA dishes north — point the lane and we push.',
  }),
  Object.freeze({
    id: 'dep_m2_at',
    event: 'mission_deploy',
    priority: 'BANTER',
    missionFilter: 2,
    roleFilter: 'anti_armor',
    text: 'Dust plume on Highway 14. Convoy armor ahead — ready to mount up or engage on foot.',
  }),
  Object.freeze({
    id: 'dep_m3_recon',
    event: 'mission_deploy',
    priority: 'BANTER',
    missionFilter: 3,
    roleFilter: 'recon',
    text: 'Sweep towers live across Sector 4. Keep out of the beams and suppress anything that spots us.',
  }),
  Object.freeze({
    id: 'dep_m4_medic',
    event: 'mission_deploy',
    priority: 'BANTER',
    missionFilter: 4,
    roleFilter: 'medic',
    text: 'Tight river bridges ahead. Tightening formation to single file — watch the northern canopy.',
  }),
  Object.freeze({
    id: 'dep_m5_support',
    event: 'mission_deploy',
    priority: 'BANTER',
    missionFilter: 5,
    roleFilter: 'support',
    text: 'Kirov Foundry is locked down tight. We crack the vats, drop their gunship, and punch out north.',
  }),
  Object.freeze({
    id: 'dep_generic',
    event: 'mission_deploy',
    priority: 'BANTER',
    text: 'Fireteam Zero-Hour on net. Weapon safeties off — awaiting your tactical lead.',
  }),

  // --- CAMPAIGN CONSEQUENCE ACKNOWLEDGEMENTS ---
  Object.freeze({
    id: 'cons_op1_comms',
    event: 'campaign_consequence_ack',
    priority: 'TACTICAL',
    consequenceFilter: 'op1_comms_destroyed',
    text: 'Our Iron Dawn strike paid off — enemy radio relays are lagging hard across this sector.',
  }),
  Object.freeze({
    id: 'cons_op2_fuel',
    event: 'campaign_consequence_ack',
    priority: 'TACTICAL',
    consequenceFilter: 'op2_fuel_cache_secured',
    text: 'Highway 14 munitions drop confirmed — extra supply charges and C4 staged forward.',
  }),
  Object.freeze({
    id: 'cons_op3_radar',
    event: 'campaign_consequence_ack',
    priority: 'TACTICAL',
    consequenceFilter: 'op3_radar_network_disabled',
    text: 'Nightfall radar grid is still dark. Hostile drone and gunship response is measurably thinner.',
  }),
  Object.freeze({
    id: 'cons_op4_jammer',
    event: 'campaign_consequence_ack',
    priority: 'TACTICAL',
    consequenceFilter: 'op4_comms_jammer_planted',
    text: 'Viper jammer is scrambling foundry QRF dispatches — expect fragmented counterattacks.',
  }),

  // --- RETURNING FROM INJURY ---
  Object.freeze({
    id: 'injury_return_1',
    event: 'injury_return',
    priority: 'BANTER',
    text: 'Cleared by medbay and back on the roster. Ready to settle the score, Commander.',
  }),

  // --- TACTICAL ORDER ACKNOWLEDGEMENTS ---
  Object.freeze({
    id: 'ack_flank_assault',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'FLANK',
    roleFilter: 'assault',
    text: 'Breaking wide on the flank — keep them pinned while I close the angle!',
  }),
  Object.freeze({
    id: 'ack_flank_any',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'FLANK',
    text: 'Copy flank — bounding laterally on your mark.',
  }),
  Object.freeze({
    id: 'ack_suppress_support',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'SUPPRESS',
    roleFilter: 'support',
    text: 'SAW set! Laying down heavy suppression — move when ready!',
  }),
  Object.freeze({
    id: 'ack_suppress_any',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'SUPPRESS',
    text: 'Suppressing designated sector — keeping hostile heads down.',
  }),
  Object.freeze({
    id: 'ack_attack_at',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'ATTACK_TARGET',
    roleFilter: 'anti_armor',
    text: 'Target locked in sight — putting ordnance on that position!',
  }),
  Object.freeze({
    id: 'ack_attack_any',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'ATTACK_TARGET',
    text: 'Engaging designated contact — fireteam focusing fire.',
  }),
  Object.freeze({
    id: 'ack_hold',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'HOLD',
    text: 'Digging into hard cover — holding this firing lane.',
  }),
  Object.freeze({
    id: 'ack_defend',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'DEFEND',
    text: 'Defensive perimeter established — covering all approaches.',
  }),
  Object.freeze({
    id: 'ack_regroup',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'REGROUP',
    text: 'Forming back on your six — tight wedge.',
  }),
  Object.freeze({
    id: 'ack_move',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'MOVE',
    text: 'Bounding to designated waypoint — cover our advance.',
  }),
  Object.freeze({
    id: 'ack_board',
    event: 'order_ack',
    priority: 'TACTICAL',
    orderFilter: 'BOARD_VEHICLE',
    text: 'Moving to mount vehicle — weapons ready on the gun mount.',
  }),

  // --- COMBAT & TRIAGE EVENTS ---
  Object.freeze({
    id: 'spot_recon',
    event: 'enemy_spotted',
    priority: 'TACTICAL',
    roleFilter: 'recon',
    text: 'High-value threat marked on shared HUD — watch elevated firing lanes.',
  }),
  Object.freeze({
    id: 'hvk_at',
    event: 'high_value_kill',
    priority: 'TACTICAL',
    roleFilter: 'anti_armor',
    text: 'Heavy armor neutralized — scratch one steel target!',
  }),
  Object.freeze({
    id: 'hvk_any',
    event: 'high_value_kill',
    priority: 'TACTICAL',
    text: 'Hostile threat down — lane is clear, pushing momentum.',
  }),
  Object.freeze({
    id: 'downed_crit',
    event: 'operator_downed',
    priority: 'CRITICAL',
    text: 'I am hit — armor breached! Need triage before bleedout!',
  }),
  Object.freeze({
    id: 'medic_revive_crit',
    event: 'medic_revive',
    priority: 'CRITICAL',
    roleFilter: 'medic',
    text: 'Trauma seal applied — get back in cover and stay in the fight!',
  }),
  Object.freeze({
    id: 'player_revive_crit',
    event: 'player_revive',
    priority: 'CRITICAL',
    text: 'Good pull, Commander — owed you one. Weapon up and back on formation.',
  }),
  Object.freeze({
    id: 'low_ammo',
    event: 'low_ammo_warn',
    priority: 'TACTICAL',
    text: 'Watch your reserve count, Commander — hit the nearest supply crate before the next push.',
  }),
  Object.freeze({
    id: 'stage_adv',
    event: 'stage_advance',
    priority: 'TACTICAL',
    text: 'Stage cleared — take five seconds to reload and resupply before we press forward.',
  }),
  Object.freeze({
    id: 'extract_live',
    event: 'extraction_live',
    priority: 'CRITICAL',
    text: 'Extraction corridor is green! Collapse on the north tunnel — leave no one behind!',
  }),
]);
