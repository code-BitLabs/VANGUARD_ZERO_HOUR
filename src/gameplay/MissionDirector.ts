import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { MiniMapBlip, ObjectiveStatus } from '@/src/schemas/events.schema';
import { MissionConfig } from '@/src/schemas/mission.schema';

export interface MissionRuntimeSummary {
  victory: boolean;
  score: number;
  grade: MissionGrade;
  xpEarned: number;
  requisitionEarned: number;
  kills: number;
  headshots: number;
  airKills: number;
  durationSec: number;
}

export class MissionDirector {
  private objectives: Array<{
    id: string;
    title: string;
    type: MissionConfig['objectives'][number]['type'];
    current: number;
    target: number;
    completed: boolean;
    markerPos: { x: number; y: number; z: number };
  }> = [];

  public score = 0;
  public kills = 0;
  public headshots = 0;
  public airKills = 0;
  public elapsedSec = 0;
  public alertText: string | null = null;
  public subtitleText: string | null = null;
  private alertTimer = 0;
  private subtitleTimer = 0;
  private checkpointHealth = 100;
  private checkpointArmor = 100;
  private missionEnded = false;

  constructor(
    private readonly config: MissionConfig,
    private readonly difficulty: Difficulty
  ) {
    this.objectives = config.objectives.map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
      current: 0,
      target: o.targetCount,
      completed: false,
      markerPos: o.markerPos,
    }));
    this.showAlert(`${config.codeName}: ${config.title.toUpperCase()}`, 4.2);
    this.showSubtitle(`COMMAND: ${config.subtitle}. All squads weapons free.`, 5.0);
  }

  showAlert(text: string, duration = 3.2): void {
    this.alertText = text;
    this.alertTimer = duration;
  }

  showSubtitle(text: string, duration = 4.2): void {
    this.subtitleText = text;
    this.subtitleTimer = duration;
  }

  onEnemyKilled(isHeadshot: boolean, points: number): void {
    this.kills++;
    if (isHeadshot) this.headshots++;
    this.score += points + (isHeadshot ? 50 : 0);
    this.advanceObjectiveType('eliminate_wave', 1);
  }

  onAirUnitKilled(points: number): void {
    this.kills++;
    this.airKills++;
    this.score += points;
    this.advanceObjectiveType('air_defense', 1);
  }

  onDestructibleTargetDestroyed(points: number): void {
    this.score += points;
    this.advanceObjectiveType('destroy_targets', 1);
    this.advanceObjectiveType('plant_charge', 1);
  }

  onConvoyVehicleDestroyed(points: number): void {
    this.score += points;
    this.advanceObjectiveType('convoy_intercept', 1);
  }

  onExtractionReached(): void {
    // Require other objectives to be complete or nearly complete before final extraction
    const nonExtract = this.objectives.filter((o) => o.type !== 'vehicle_extract');
    const allPreDone = nonExtract.every((o) => o.completed);
    if (allPreDone) {
      this.advanceObjectiveType('vehicle_extract', 1);
    }
  }

  private advanceObjectiveType(type: MissionConfig['objectives'][number]['type'], delta: number): void {
    for (const o of this.objectives) {
      if (o.type === type && !o.completed) {
        o.current = Math.min(o.target, o.current + delta);
        if (o.current >= o.target) {
          o.completed = true;
          this.score += 350;
          this.showAlert(`OBJECTIVE COMPLETE: ${o.title.toUpperCase()}`, 3.4);
        }
        break;
      }
    }
  }

  update(dt: number, playerHealth: number, playerArmor: number): { finished: boolean; victory: boolean } {
    this.elapsedSec += dt;
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.alertText = null;
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleText = null;
    }

    if (playerHealth > 40) {
      this.checkpointHealth = Math.max(65, playerHealth);
      this.checkpointArmor = Math.max(50, playerArmor);
    }

    if (this.missionEnded) return { finished: true, victory: playerHealth > 0 };

    if (playerHealth <= 0) {
      this.missionEnded = true;
      return { finished: true, victory: false };
    }

    const allDone = this.objectives.every((o) => o.completed);
    if (allDone) {
      this.missionEnded = true;
      return { finished: true, victory: true };
    }

    return { finished: false, victory: false };
  }

  getCheckpointStats(): { health: number; armor: number } {
    return { health: this.checkpointHealth, armor: this.checkpointArmor };
  }

  getObjectiveStatuses(): ObjectiveStatus[] {
    return this.objectives.map((o) => ({
      id: o.id,
      title: o.title,
      current: o.current,
      target: o.target,
      completed: o.completed,
    }));
  }

  getObjectiveBlips(): MiniMapBlip[] {
    return this.objectives
      .filter((o) => !o.completed)
      .map((o) => ({
        id: o.id,
        x: o.markerPos.x,
        z: o.markerPos.z,
        kind: 'objective',
      }));
  }

  buildSummary(victory: boolean): MissionRuntimeSummary {
    const diffBonus: Record<Difficulty, number> = {
      easy: 0.85,
      normal: 1.0,
      hard: 1.35,
      extreme: 1.75,
    };
    const timeBonus = victory ? Math.max(0, Math.round((this.config.parTimeSec - this.elapsedSec) * 6)) : 0;
    const totalScore = Math.round((this.score + timeBonus) * diffBonus[this.difficulty]);

    let grade: MissionGrade = 'C';
    if (victory) {
      if (totalScore >= 2600 && this.elapsedSec <= this.config.parTimeSec * 1.1) grade = 'S';
      else if (totalScore >= 1800) grade = 'A';
      else if (totalScore >= 1100) grade = 'B';
    }

    const xpEarned = victory
      ? Math.round((this.config.baseXpReward + totalScore * 0.25) * diffBonus[this.difficulty])
      : Math.round(this.kills * 22);
    const requisitionEarned = victory ? Math.round(140 + totalScore * 0.08) : Math.round(25 + this.kills * 4);

    return {
      victory,
      score: totalScore,
      grade,
      xpEarned,
      requisitionEarned,
      kills: this.kills,
      headshots: this.headshots,
      airKills: this.airKills,
      durationSec: Math.round(this.elapsedSec),
    };
  }
}
