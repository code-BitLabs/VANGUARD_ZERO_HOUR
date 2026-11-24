import React, { useMemo, useState, useTransition } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Maximize2,
  Minimize2,
  Play,
  Wrench,
} from 'lucide-react';
import { getMissionById } from '@/src/data/missions';
import { validateDeploymentConfig } from '@/src/gameplay/campaign/DeploymentConfigValidator';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { useUIStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { useFullscreen } from '@/src/utils/fullscreen';
import { Button } from '@/src/ui/primitives/Button';
import { AttachmentWorkbenchDrawer } from '@/src/ui/screens/campaign/AttachmentWorkbenchDrawer';
import {
  CampaignSecondaryDrawers,
  SecondaryDrawerTab,
} from '@/src/ui/screens/campaign/CampaignSecondaryDrawers';
import { StepConfigureOperation } from '@/src/ui/screens/campaign/StepConfigureOperation';
import { StepMissionSelect } from '@/src/ui/screens/campaign/StepMissionSelect';
import { StepPlayStyle } from '@/src/ui/screens/campaign/StepPlayStyle';
import { StepReviewDeploy } from '@/src/ui/screens/campaign/StepReviewDeploy';

interface CampaignScreenProps {
  onDeploy: (missionId: number, difficulty: Difficulty, mode?: DeploymentMode) => void;
  onUiClick: () => void;
}

type CampaignStep = 1 | 2 | 3 | 4;

const STEP_ITEMS: ReadonlyArray<{ step: CampaignStep; label: string; shortLabel: string }> = [
  { step: 1, label: '1. Mission', shortLabel: '1. Mission' },
  { step: 2, label: '2. Play Style', shortLabel: '2. Style' },
  { step: 3, label: '3. Configure', shortLabel: '3. Config' },
  { step: 4, label: '4. Review & Deploy', shortLabel: '4. Deploy' },
];

export function CampaignScreen({ onDeploy, onUiClick }: CampaignScreenProps) {
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const replayMode = useMissionSelectionStore((s) => s.replayMode);
  const deploymentModeDefault = useMissionSelectionStore((s) => s.deploymentMode);
  const missionDeploymentModes = useMissionSelectionStore((s) => s.missionDeploymentModes);
  const hasConfirmedDeploymentMode = useMissionSelectionStore((s) => s.hasConfirmedDeploymentMode);
  const setSelectedMission = useMissionSelectionStore((s) => s.setSelectedMission);
  const setDeploymentMode = useMissionSelectionStore((s) => s.setDeploymentMode);
  const confirmDeploymentMode = useMissionSelectionStore((s) => s.confirmDeploymentMode);
  const markMissionBriefingSeen = useMissionSelectionStore((s) => s.markMissionBriefingSeen);

  const save = useProgressionStore((s) => s.save);
  const setScreen = useUIStore((s) => s.setScreen);
  const viewport = useViewportMode();
  const { isFullscreen, isSupported, toggleFullscreen, requestFullscreen } = useFullscreen();

  const [activeStep, setActiveStep] = useState<CampaignStep>(1);
  const [secondaryDrawerTab, setSecondaryDrawerTab] = useState<SecondaryDrawerTab | null>(null);
  const [, startCampaignTransition] = useTransition();
  const [workbenchState, setWorkbenchState] = useState<{
    open: boolean;
    weaponId: WeaponId;
    slotLabel: string;
  }>({
    open: false,
    weaponId: save.activeMissionLoadout.primaryWeapon,
    slotLabel: 'Primary Weapon',
  });

  const mission = getMissionById(selectedMissionId);
  const activeMode: DeploymentMode =
    missionDeploymentModes[String(selectedMissionId)] ?? deploymentModeDefault;

  const clearedCount = Object.values(save.missionRecords).filter((r) => r.completed).length;

  const validation = useMemo(
    () =>
      validateDeploymentConfig({
        missionId: selectedMissionId,
        deploymentMode: activeMode,
        difficulty,
        replayMode,
        loadout: save.activeMissionLoadout,
        roster: save.squadRoster,
        hasConfirmedDeploymentMode,
      }),
    [
      selectedMissionId,
      activeMode,
      difficulty,
      replayMode,
      save.activeMissionLoadout,
      save.squadRoster,
      hasConfirmedDeploymentMode,
    ]
  );

  const handleSelectMode = (mode: DeploymentMode) => {
    setDeploymentMode(mode, selectedMissionId);
  };

  const handleGoToStep = (nextStep: CampaignStep) => {
    if (nextStep >= 3 && !hasConfirmedDeploymentMode) {
      confirmDeploymentMode(activeMode, selectedMissionId);
    }
    startCampaignTransition(() => {
      setActiveStep(nextStep);
    });
  };

  const handleDeployNow = () => {
    if (viewport.isCoarsePointer && isSupported && !isFullscreen) {
      void requestFullscreen();
    }
    confirmDeploymentMode(activeMode, selectedMissionId);
    markMissionBriefingSeen(mission.missionKey, mission.briefingVersion);
    onDeploy(mission.id, difficulty, activeMode);
  };

  const handleOpenWorkbench = (weaponId: WeaponId, slotLabel: string) => {
    setWorkbenchState({ open: true, weaponId, slotLabel });
  };

  return (
    <div
      data-testid="campaign-operations-screen"
      className="fixed inset-0 z-30 flex flex-col bg-[#0B0E11] text-zinc-100 select-none overflow-hidden"
    >
      {/* Top HQ Command Header */}
      <header className="shrink-0 bg-[#11161D] border-b border-zinc-800 px-3 sm:px-6 py-2 [@media(max-height:520px)]:py-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            aria-label="HQ Menu"
            onClick={() => {
              onUiClick();
              setScreen('title');
            }}
            className="min-h-[44px] sm:min-h-[36px] [@media(max-height:520px)]:min-h-[34px] px-2.5 py-1 rounded-xs bg-[#0B0E11] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 hover:text-white inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">HQ Menu</span>
          </button>

          <div className="min-w-0">
            <h1 className="font-display text-sm sm:text-lg [@media(max-height:520px)]:text-sm font-bold uppercase tracking-wide text-white truncate">
              Campaign Operations
            </h1>
            <div className="font-mono text-[10px] text-zinc-400 tabular-nums hidden sm:block [@media(max-height:520px)]:hidden">
              {clearedCount}/5 Operations Cleared · {save.requisitionPoints} REQ
            </div>
          </div>
        </div>

        {/* Utility Actions (Compact, Non-Competing) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="sm:hidden [@media(max-height:520px)]:inline font-mono text-[10px] text-amber-300 tabular-nums mr-1">
            {save.requisitionPoints} REQ
          </span>

          <button
            type="button"
            data-testid="header-open-briefing"
            aria-label="Briefing Dossier"
            title="Briefing Dossier"
            onClick={() => {
              onUiClick();
              setSecondaryDrawerTab('briefing');
            }}
            className="min-h-[44px] sm:min-h-[36px] [@media(max-height:520px)]:min-h-[34px] min-w-[40px] px-2.5 py-1 rounded-xs bg-[#0B0E11] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 hover:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Briefing Dossier</span>
          </button>

          <button
            type="button"
            data-testid="header-open-armory"
            aria-label="Full Armory"
            title="Full Armory"
            onClick={() => {
              onUiClick();
              setScreen('armory');
            }}
            className="min-h-[44px] sm:min-h-[36px] [@media(max-height:520px)]:min-h-[34px] min-w-[40px] px-2.5 py-1 rounded-xs bg-[#0B0E11] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 hover:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Full Armory</span>
          </button>

          {isSupported && (
            <button
              type="button"
              data-testid="header-toggle-fullscreen"
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              onClick={() => {
                onUiClick();
                void toggleFullscreen();
              }}
              className="min-h-[44px] sm:min-h-[36px] [@media(max-height:520px)]:min-h-[34px] min-w-[40px] px-2.5 py-1 rounded-xs bg-[#0B0E11] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 hover:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-zinc-300 hover:text-amber-400" />
              )}
              <span className="hidden md:inline">{isFullscreen ? 'Windowed' : 'Fullscreen'}</span>
            </button>
          )}
        </div>
      </header>

      {/* 4-Step Progressive Disclosure Stepper Rail */}
      <nav
        aria-label="Campaign deployment steps"
        className="shrink-0 bg-[#0E1319] border-b border-zinc-800/90 px-3 sm:px-6 py-1.5 [@media(max-height:520px)]:py-0.5"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <ol className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
            {STEP_ITEMS.map((item) => {
              const isCurrent = activeStep === item.step;
              const isCompleted = activeStep > item.step;
              return (
                <li key={item.step} className="shrink-0">
                  <button
                    type="button"
                    data-testid={`campaign-step-tab-${item.step}`}
                    aria-current={isCurrent ? 'step' : undefined}
                    onClick={() => {
                      onUiClick();
                      handleGoToStep(item.step);
                    }}
                    className={`min-h-[40px] sm:min-h-[34px] [@media(max-height:520px)]:min-h-[30px] px-2 sm:px-3 [@media(max-height:520px)]:px-2 py-1 [@media(max-height:520px)]:py-0.5 rounded-xs border font-mono text-[10px] sm:text-[10.5px] uppercase tracking-wider inline-flex items-center gap-1 transition-colors motion-reduce:transition-none cursor-pointer ${
                      isCurrent
                        ? 'bg-amber-500/15 border-amber-400 text-amber-200 font-bold'
                        : isCompleted
                          ? 'bg-[#141920] border-zinc-700 text-zinc-200 hover:border-zinc-500'
                          : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-800'
                    }`}
                  >
                    {isCompleted && <Check className="w-3 h-3 text-emerald-400" />}
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className="sm:hidden">{item.shortLabel}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Compact Context Indicator on Steps 3-4 */}
          {activeStep >= 3 && (
            <div className="hidden md:flex items-center gap-2 font-mono text-[10.5px] uppercase text-zinc-400 shrink-0">
              <span className="text-zinc-200">OP 0{mission.id}</span>
              <span className="text-zinc-600">·</span>
              <span className={activeMode === 'solo' ? 'text-amber-400' : 'text-cyan-400'}>
                {activeMode === 'solo' ? 'Solo Operator' : 'Fireteam'}
              </span>
            </div>
          )}
        </div>
      </nav>

      {/* Main Step Workspace */}
      <main
        className={
          viewport.isCompactLandscape
            ? 'flex-1 min-h-0 overflow-y-auto px-3 py-1'
            : 'flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4'
        }
      >
        <div className="max-w-7xl mx-auto">
          {activeStep === 1 && (
            <StepMissionSelect
              selectedMissionId={selectedMissionId}
              onSelectMission={(id) => {
                setSelectedMission(id);
              }}
              onPrepareDeployment={() => handleGoToStep(2)}
              onOpenFullBriefing={() => setSecondaryDrawerTab('briefing')}
              onUiClick={onUiClick}
            />
          )}

          {activeStep === 2 && (
            <StepPlayStyle
              missionId={selectedMissionId}
              selectedMode={activeMode}
              hasConfirmedMode={hasConfirmedDeploymentMode}
              onSelectMode={handleSelectMode}
              onUiClick={onUiClick}
            />
          )}

          {activeStep === 3 && (
            <StepConfigureOperation
              missionId={selectedMissionId}
              deploymentMode={activeMode}
              onOpenWorkbench={handleOpenWorkbench}
              onOpenSecondaryDrawer={(tab) => setSecondaryDrawerTab(tab)}
              onUiClick={onUiClick}
            />
          )}

          {activeStep === 4 && (
            <StepReviewDeploy
              missionId={selectedMissionId}
              deploymentMode={activeMode}
              onJumpToStep={(step) => handleGoToStep(step)}
              onOpenSecondaryDrawer={(tab) => setSecondaryDrawerTab(tab)}
              onDeploy={handleDeployNow}
              onUiClick={onUiClick}
            />
          )}
        </div>
      </main>

      {/* Compact Sticky Bottom Step Navigation Bar (capped <= 52px + safe area for constrained mobile landscape) */}
      <footer
        data-testid="campaign-sticky-footer"
        className="shrink-0 bg-[#11161D] border-t border-zinc-800 px-3 sm:px-6 py-2 [@media(max-height:520px)]:py-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))]"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0">
            {activeStep > 1 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="campaign-step-back"
                onClick={() => {
                  onUiClick();
                  handleGoToStep((activeStep - 1) as CampaignStep);
                }}
                className="min-h-[44px] sm:min-h-[38px] [@media(max-height:520px)]:min-h-[34px]"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back
              </Button>
            ) : (
              <div className="font-mono text-[10.5px] text-zinc-400 truncate max-w-[136px] min-[380px]:max-w-[180px] sm:max-w-none">
                Selected: <span className="text-zinc-200">{mission.title}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeStep === 1 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="campaign-step1-continue"
                onClick={() => {
                  onUiClick();
                  handleGoToStep(2);
                }}
                className="min-h-[44px] sm:min-h-[38px] [@media(max-height:520px)]:min-h-[34px]"
              >
                Prepare Deployment
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {activeStep === 2 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="campaign-step2-continue"
                onClick={() => {
                  onUiClick();
                  confirmDeploymentMode(activeMode, selectedMissionId);
                  handleGoToStep(3);
                }}
                className="min-h-[44px] sm:min-h-[38px] [@media(max-height:520px)]:min-h-[34px]"
              >
                Continue as {activeMode === 'solo' ? 'Solo' : 'Fireteam'}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {activeStep === 3 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="campaign-step3-continue"
                onClick={() => {
                  onUiClick();
                  handleGoToStep(4);
                }}
                className="min-h-[44px] sm:min-h-[38px] [@media(max-height:520px)]:min-h-[34px]"
              >
                Review & Deploy
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {activeStep === 4 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!validation.canDeploy}
                data-testid="campaign-footer-deploy"
                onClick={() => {
                  onUiClick();
                  handleDeployNow();
                }}
                className="min-h-[44px] sm:min-h-[38px] [@media(max-height:520px)]:min-h-[34px]"
              >
                <Play className="w-4 h-4 mr-1.5 fill-current" />
                Deploy Operation
              </Button>
            )}
          </div>
        </div>
      </footer>

      {/* Slide-Over Inline Attachment Workbench Drawer */}
      <AttachmentWorkbenchDrawer
        open={workbenchState.open}
        weaponId={workbenchState.weaponId}
        slotLabel={workbenchState.slotLabel}
        onClose={() => setWorkbenchState((prev) => ({ ...prev, open: false }))}
        onOpenFullArmory={() => {
          setWorkbenchState((prev) => ({ ...prev, open: false }));
          setScreen('armory');
        }}
        onUiClick={onUiClick}
      />

      {/* Progressive-Disclosure Secondary Drawers (Intel, Rules, Performance, Controls, Briefing) */}
      <CampaignSecondaryDrawers
        openTab={secondaryDrawerTab}
        missionId={selectedMissionId}
        deploymentMode={activeMode}
        onSelectTab={(tab) => startCampaignTransition(() => setSecondaryDrawerTab(tab))}
        onClose={() => setSecondaryDrawerTab(null)}
        onUiClick={onUiClick}
      />
    </div>
  );
}
