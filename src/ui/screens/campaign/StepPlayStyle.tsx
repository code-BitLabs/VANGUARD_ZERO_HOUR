import React, { useState } from 'react';
import { Check, Shield, User, Users } from 'lucide-react';
import { getMissionById } from '@/src/data/missions';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import soloModeImg from '@/src/assets/images/mode_solo_operator_1795162695115.webp';
import fireteamModeImg from '@/src/assets/images/mode_fireteam_squad_1795162698191.webp';

interface StepPlayStyleProps {
  missionId: number;
  selectedMode: DeploymentMode;
  hasConfirmedMode: boolean;
  onSelectMode: (mode: DeploymentMode) => void;
  onUiClick: () => void;
}

export function StepPlayStyle({
  missionId,
  selectedMode,
  hasConfirmedMode,
  onSelectMode,
  onUiClick,
}: StepPlayStyleProps) {
  const save = useProgressionStore((s) => s.save);
  const viewport = useViewportMode();
  const mission = getMissionById(missionId);
  const [imgErrors, setImgErrors] = useState<{ solo?: boolean; fireteam?: boolean }>({});

  const isCompactLandscape = viewport.isCompactLandscape;
  const activeOperators = save.squadRoster.filter((op) => op.status === 'active').length;
  const recoveringOperators = save.squadRoster.filter((op) => op.status === 'recovering').length;

  const cards: Array<{
    mode: DeploymentMode;
    title: string;
    subtitle: string;
    imageSrc: string;
    imageAlt: string;
    fallbackGradient: string;
    icon: React.ReactNode;
    points: string[];
    rosterNote: string;
  }> = [
    {
      mode: 'solo',
      title: 'Solo Operator',
      subtitle: 'Single-Player · Lone Tactical Specialist',
      imageSrc: soloModeImg,
      imageAlt: 'Lone tactical operator surveying an urban combat zone',
      fallbackGradient: 'linear-gradient(135deg, #1b222c 0%, #3a2d1d 55%, #0f1318 100%)',
      icon: <User className={isCompactLandscape ? 'w-4 h-4 text-amber-400' : 'w-5 h-5 text-amber-400'} />,
      points: [
        'Deploy alone with zero AI companions and no squad command overhead.',
        'Adaptive Solo Director staggers pushes and caps multi-squad focus.',
        '1 emergency trauma self-revive plus bonus finite cover caches.',
      ],
      rosterNote:
        recoveringOperators > 0
          ? `${recoveringOperators} recovering specialist${recoveringOperators > 1 ? 's' : ''} rest safely at HQ with zero risk.`
          : 'Full enemy lethality, boss mechanics, and mission objectives preserved.',
    },
    {
      mode: 'fireteam',
      title: 'Fireteam',
      subtitle: 'Single-Player · You + 3 AI Specialists',
      imageSrc: fireteamModeImg,
      imageAlt: 'Four-operator tactical fireteam advancing in formation',
      fallbackGradient: 'linear-gradient(135deg, #12212d 0%, #1c3a4c 55%, #0f1318 100%)',
      icon: <Users className={isCompactLandscape ? 'w-4 h-4 text-cyan-400' : 'w-5 h-5 text-cyan-400'} />,
      points: [
        'Lead up to 3 specialist AI companions (Assault, Support, Recon, Medic).',
        'Issue tactical formations, flanking orders, suppression, and revives.',
        'Customize squad composition, formation, and roster progression.',
      ],
      rosterNote: `${activeOperators}/5 specialists active${recoveringOperators > 0 ? ` · ${recoveringOperators} recovering` : ''}.`,
    },
  ];

  return (
    <div
      data-testid="campaign-step-playstyle"
      className={isCompactLandscape ? 'space-y-1.5' : 'space-y-3 [@media(max-height:520px)]:space-y-2'}
    >
      <div
        className={
          isCompactLandscape
            ? 'flex items-center justify-between gap-1.5 border-b border-zinc-800 pb-1'
            : 'flex flex-wrap items-end justify-between gap-1.5 border-b border-zinc-800 pb-2 [@media(max-height:520px)]:pb-1.5'
        }
      >
        <div>
          <div className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-amber-400">
            Step 2 of 4 · {mission.codeName}
          </div>
          <h2
            className={
              isCompactLandscape
                ? 'font-display text-sm sm:text-base font-bold uppercase text-white mt-0.5'
                : 'font-display text-lg sm:text-2xl [@media(max-height:520px)]:text-base font-bold uppercase text-white mt-0.5'
            }
          >
            Choose Your Single-Player Deployment Style
          </h2>
        </div>

        <div className="font-mono text-[10px] sm:text-[11px] text-zinc-400 hidden sm:block [@media(max-height:520px)]:hidden">
          {hasConfirmedMode
            ? `Remembered: ${selectedMode === 'solo' ? 'Solo' : 'Fireteam'}`
            : 'Select mode to continue'}
        </div>
      </div>

      {/* Two Distinct Mode Cards */}
      <div
        className={
          isCompactLandscape
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5'
            : 'grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 [@media(max-height:520px)]:gap-2.5'
        }
      >
        {cards.map((card) => {
          const isSelected = selectedMode === card.mode;
          const imgFailed = Boolean(imgErrors[card.mode]);
          return (
            <button
              key={card.mode}
              type="button"
              data-testid={`playstyle-card-${card.mode}`}
              aria-pressed={isSelected}
              onClick={() => {
                onUiClick();
                onSelectMode(card.mode);
              }}
              className={`group rounded-sm border text-left overflow-hidden flex flex-col transition-colors motion-reduce:transition-none cursor-pointer ${
                isSelected
                  ? card.mode === 'solo'
                    ? 'bg-[#141920] border-amber-400 ring-1 ring-amber-400/50'
                    : 'bg-[#141920] border-cyan-400 ring-1 ring-cyan-400/50'
                  : 'bg-[#11161D] border-zinc-800 hover:border-zinc-600'
              }`}
            >
              {/* Card Artwork */}
              <div
                className={
                  isCompactLandscape
                    ? 'relative h-14 sm:h-16 w-full overflow-hidden border-b border-zinc-800'
                    : 'relative h-32 sm:h-40 [@media(max-height:520px)]:h-20 [@media(max-height:440px)]:h-14 w-full overflow-hidden border-b border-zinc-800'
                }
                style={{ background: card.fallbackGradient }}
              >
                {!imgFailed && (
                  <img
                    src={card.imageSrc}
                    alt={card.imageAlt}
                    referrerPolicy="no-referrer"
                    onError={() => setImgErrors((prev) => ({ ...prev, [card.mode]: true }))}
                    className="w-full h-full object-cover object-center opacity-85 group-hover:opacity-95 transition-opacity"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#141920] via-[#141920]/40 to-transparent" />

                <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                  {isSelected ? (
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-xs font-mono text-[8.5px] sm:text-[9px] font-bold uppercase ${
                        card.mode === 'solo'
                          ? 'bg-amber-500 text-zinc-950'
                          : 'bg-cyan-400 text-zinc-950'
                      }`}
                    >
                      <Check className="w-2.5 h-2.5" /> Selected
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-xs bg-[#0B0E11]/85 border border-zinc-700 font-mono text-[8.5px] sm:text-[9px] uppercase text-zinc-300">
                      Single-Player
                    </span>
                  )}
                </div>

                <div className="absolute bottom-1.5 left-2 right-2 sm:bottom-2 sm:left-3 sm:right-3 flex items-center gap-1.5">
                  <div className="p-1 sm:p-1.5 bg-[#0B0E11]/90 border border-zinc-700 rounded-xs shrink-0">
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <div
                      className={
                        isCompactLandscape
                          ? 'font-display text-xs sm:text-sm font-bold uppercase text-white leading-none'
                          : 'font-display text-lg sm:text-2xl [@media(max-height:520px)]:text-base font-bold uppercase text-white leading-none'
                      }
                    >
                      {card.title}
                    </div>
                    <div className="font-mono text-[8.5px] sm:text-[9px] uppercase tracking-wider text-zinc-300 mt-0.5 truncate">
                      {card.subtitle}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Structured Tactical Points */}
              <div
                className={
                  isCompactLandscape
                    ? 'p-2 sm:p-2.5 flex-1 flex flex-col justify-between gap-1 overflow-y-auto max-h-[120px]'
                    : 'p-3 sm:p-4 [@media(max-height:520px)]:p-2.5 flex-1 flex flex-col justify-between gap-2 [@media(max-height:520px)]:gap-1.5'
                }
              >
                <ul
                  className={
                    isCompactLandscape
                      ? 'space-y-0.5 text-[9.5px] sm:text-[10px] text-zinc-200 leading-tight'
                      : 'space-y-1.5 [@media(max-height:520px)]:space-y-1 text-xs sm:text-[13px] [@media(max-height:520px)]:text-[11px] text-zinc-200 leading-snug'
                  }
                >
                  {card.points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span
                        className={`font-mono text-[9px] shrink-0 mt-0.5 ${
                          card.mode === 'solo' ? 'text-amber-400' : 'text-cyan-400'
                        }`}
                      >
                        —
                      </span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>

                <div
                  className={
                    isCompactLandscape
                      ? 'pt-1 border-t border-zinc-800/90 flex items-center gap-1 font-mono text-[8.5px] sm:text-[9px] text-zinc-400 truncate'
                      : 'pt-2 [@media(max-height:520px)]:pt-1.5 border-t border-zinc-800/90 flex items-center gap-1.5 font-mono text-[10px] sm:text-[10.5px] text-zinc-400'
                  }
                >
                  <Shield className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="truncate">{card.rosterNote}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
