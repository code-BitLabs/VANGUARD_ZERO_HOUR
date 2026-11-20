import {
  DialogueEventType,
  DialoguePriority,
  getOperatorVoiceProfile,
  OperatorCommendation,
  OperatorVoiceProfile,
  SQUAD_DIALOGUE_CATALOG,
} from '@/src/data/squadDialogue';
import { CampaignEventId, SquadRoleId } from '@/src/schemas/campaign.schema';
import { SquadOperatorMissionReport } from '@/src/stores/progressionStore';

export interface ActiveRadioTransmission {
  readonly id: number;
  readonly operatorId: string;
  readonly callsign: string;
  readonly role: SquadRoleId;
  readonly text: string;
  readonly priority: DialoguePriority;
  readonly voice: OperatorVoiceProfile;
  readonly event: DialogueEventType;
  readonly expiresAtSec: number;
}

export interface DialogueTriggerInput {
  event: DialogueEventType;
  nowSec: number;
  operatorId?: string;
  callsign?: string;
  role?: SquadRoleId;
  missionId?: number;
  order?: string;
  consequenceEventId?: CampaignEventId;
  customText?: string;
}

const GLOBAL_COOLDOWN_BY_PRIORITY_SEC: Readonly<Record<DialoguePriority, number>> = Object.freeze({
  CRITICAL: 0.25,
  TACTICAL: 3.4,
  BANTER: 8.5,
});

const CATEGORY_COOLDOWN_SEC: Readonly<Partial<Record<DialogueEventType, number>>> = Object.freeze({
  order_ack: 1.4,
  enemy_spotted: 10.0,
  high_value_kill: 9.0,
  low_ammo_warn: 24.0,
  stage_advance: 6.0,
  mission_deploy: 30.0,
  campaign_consequence_ack: 30.0,
});

const SUBTITLE_DURATION_BY_PRIORITY_SEC: Readonly<Record<DialoguePriority, number>> = Object.freeze({
  CRITICAL: 4.8,
  TACTICAL: 3.8,
  BANTER: 4.6,
});

/**
 * TRN-46 Event-Driven Squad Dialogue & Radio Immersion Director.
 * - Strictly event-driven (never fires random chatter).
 * - Enforces priority hierarchy (CRITICAL > TACTICAL > BANTER), anti-spam cooldowns,
 *   and recent-line deduplication so radio comms stay sharp and authentic.
 */
export class SquadDialogueDirector {
  private seq = 0;
  private lastEmissionSec = -99;
  private readonly lastByEventSec = new Map<DialogueEventType, number>();
  private readonly recentTemplateIds: string[] = [];
  private activeTransmission: ActiveRadioTransmission | null = null;

  reset(): void {
    this.lastEmissionSec = -99;
    this.lastByEventSec.clear();
    this.recentTemplateIds.length = 0;
    this.activeTransmission = null;
  }

  getActiveTransmission(nowSec: number): ActiveRadioTransmission | null {
    if (this.activeTransmission && nowSec > this.activeTransmission.expiresAtSec) {
      this.activeTransmission = null;
    }
    return this.activeTransmission;
  }

  trigger(input: DialogueTriggerInput): ActiveRadioTransmission | null {
    const candidates = SQUAD_DIALOGUE_CATALOG.filter((tpl) => {
      if (tpl.event !== input.event) return false;
      if (tpl.missionFilter !== undefined && tpl.missionFilter !== input.missionId) return false;
      if (tpl.orderFilter !== undefined && tpl.orderFilter !== input.order) return false;
      if (
        tpl.consequenceFilter !== undefined &&
        tpl.consequenceFilter !== input.consequenceEventId
      ) {
        return false;
      }
      return true;
    });

    // Prefer exact role match -> specific filter match -> generic fallback
    let chosen =
      candidates.find(
        (c) => c.roleFilter !== undefined && c.roleFilter === input.role && !this.recentTemplateIds.includes(c.id)
      ) ??
      candidates.find((c) => !this.recentTemplateIds.includes(c.id)) ??
      candidates.find((c) => c.roleFilter === input.role) ??
      candidates[0];

    const priority: DialoguePriority =
      chosen?.priority ??
      (input.event === 'operator_downed' ||
      input.event === 'medic_revive' ||
      input.event === 'player_revive' ||
      input.event === 'extraction_live'
        ? 'CRITICAL'
        : 'TACTICAL');

    const text = input.customText ?? chosen?.text;
    if (!text) return null;

    // Enforce anti-chatter cooldowns (CRITICAL preempts TACTICAL/BANTER cleanly)
    const elapsedSinceGlobal = input.nowSec - this.lastEmissionSec;
    const requiredGlobal = GLOBAL_COOLDOWN_BY_PRIORITY_SEC[priority];
    if (elapsedSinceGlobal < requiredGlobal) {
      if (
        priority !== 'CRITICAL' ||
        this.activeTransmission?.priority === 'CRITICAL'
      ) {
        return null;
      }
    }

    const catCooldown = CATEGORY_COOLDOWN_SEC[input.event] ?? 2.0;
    const prevCatSec = this.lastByEventSec.get(input.event) ?? -99;
    if (priority !== 'CRITICAL' && input.nowSec - prevCatSec < catCooldown) {
      return null;
    }

    const opId = input.operatorId ?? 'overwatch_hq';
    const voice = getOperatorVoiceProfile(opId, input.role);
    const callsign = input.callsign ?? voice.callsign;
    const role = input.role ?? voice.role;

    const transmission: ActiveRadioTransmission = {
      id: ++this.seq,
      operatorId: opId,
      callsign,
      role,
      text,
      priority,
      voice,
      event: input.event,
      expiresAtSec: input.nowSec + SUBTITLE_DURATION_BY_PRIORITY_SEC[priority],
    };

    this.activeTransmission = transmission;
    this.lastEmissionSec = input.nowSec;
    this.lastByEventSec.set(input.event, input.nowSec);

    if (chosen) {
      this.recentTemplateIds.push(chosen.id);
      if (this.recentTemplateIds.length > 6) {
        this.recentTemplateIds.shift();
      }
    }

    return transmission;
  }
}

/**
 * Computes earned field commendations for debrief presentation based strictly on real mission stats (TRN-46).
 */
export function evaluateOperatorCommendations(
  report: SquadOperatorMissionReport
): OperatorCommendation[] {
  const awards: OperatorCommendation[] = [];
  if (report.revivesPerformed >= 1) {
    awards.push({
      id: 'guardian_angel',
      title: 'Guardian Angel',
      summary: `Performed ${report.revivesPerformed} combat triage rescue(s) under fire.`,
    });
  }
  if (report.vehiclesDisabled >= 1) {
    awards.push({
      id: 'armor_breaker',
      title: 'Armor Breaker',
      summary: `Neutralized ${report.vehiclesDisabled} heavy armor or vehicle threat(s).`,
    });
  }
  if (report.suppressionAssists >= 5) {
    awards.push({
      id: 'iron_wall',
      title: 'Iron Wall',
      summary: `Delivered ${report.suppressionAssists} suppressive pinning fire assists.`,
    });
  }
  if (report.spotsMarked >= 4) {
    awards.push({
      id: 'eagle_eye',
      title: 'Eagle Eye',
      summary: `Marked ${report.spotsMarked} hostile threats for shared fireteam intel.`,
    });
  }
  if (report.kills >= 4 && !report.becameMia) {
    awards.push({
      id: 'pointman_distinction',
      title: 'Pointman Distinction',
      summary: `Eliminated ${report.kills} hostiles while maintaining combat readiness.`,
    });
  }
  return awards;
}
