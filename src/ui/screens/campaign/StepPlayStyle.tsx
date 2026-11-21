import React, { useState } from 'react';
import { Check, Shield, User, Users } from 'lucide-react';
import { getMissionById } from '@/src/data/missions';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import { useProgressionStore } from '@/src/stores/progressionStore';
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
  const mission = getMissionById(missionId);
  const [imgErrors, setImgErrors] = useState<{ solo?: boolean; fireteam?: boolean }>({});

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
      icon: <User className="w-5 h-5 text-amber-400" />,
      points: [
        'Deploy alone with zero AI companions and no squad command overhead.',
        'Adaptive Solo Encounter Director staggers pushes and prevents multi-squad focus fire.',
        '1 limited emergency trauma self-revive plus bonus finite cover caches.',
      ],
      rosterNote:
        recoveringOperators > 0
          ? `${recoveringOperators} recovering Fireteam specialist${recoveringOperators > 1 ? 's' : ''} will rest safely at HQ with zero injury risk.`
          : 'Full enemy lethality, boss mechanics, and mission objectives preserved.',
    },
    {
      mode: 'fireteam',
      title: 'Fireteam',
      subtitle: 'Single-Player · You + 3 AI Specialists',
      imageSrc: fireteamModeImg,
      imageAlt: 'Four-operator tactical fireteam advancing in formation',
      fallbackGradient: 'linear-gradient(135deg, #12212d 0%, #1c3a4c 55%, #0f1318 100%)',
      icon: <Users className="w-5 h-5 text-cyan-400" />,
      points: [
        'Lead up to 3 specialist AI companions (Assault, Support, Recon, Anti-Armor, Medic).',
        'Issue tactical formations, flanking orders, suppression, and revives in combat.',
        'Customize squad composition, starting formation, and persistent roster progression.',
      ],
      rosterNote: `${activeOperators}/5 core specialists active for deployment${recoveringOperators > 0 ? ` · ${recoveringOperators} recovering at HQ` : ''}.`,
    },
  ];

  return (
    <div data-testid="campaign-step-playstyle" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
            Step 2 of 4 · {mission.codeName}
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5">
            Choose Your Single-Player Deployment Style
          </h2>
        </div>

        <div className="font-mono text-[11px] text-zinc-400">
          {hasConfirmedMode
            ? `Remembered default: ${selectedMode === 'solo' ? 'Solo Operator' : 'Fireteam'} (editable per operation)`
            : 'Select your preferred tactical mode to continue'}
        </div>
      </div>

      {/* Two Distinct Mode Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                className="relative h-36 sm:h-44 w-full overflow-hidden border-b border-zinc-800"
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

                <div className="absolute top-3 right-3">
                  {isSelected ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xs font-mono text-[10px] font-bold uppercase ${
                        card.mode === 'solo'
                          ? 'bg-amber-500 text-zinc-950'
                          : 'bg-cyan-400 text-zinc-950'
                      }`}
                    >
                      <Check className="w-3 h-3" /> Selected
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-xs bg-[#0B0E11]/85 border border-zinc-700 font-mono text-[10px] uppercase text-zinc-300">
                      Single-Player
                    </span>
                  )}
                </div>

                <div className="absolute bottom-3 left-4 right-4 flex items-center gap-2.5">
                  <div className="p-2 bg-[#0B0E11]/90 border border-zinc-700 rounded-xs shrink-0">
                    {card.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-xl sm:text-2xl font-bold uppercase text-white leading-none">
                      {card.title}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-300 mt-1">
                      {card.subtitle}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Structured Tactical Points */}
              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <ul className="space-y-2 text-xs sm:text-[13px] text-zinc-200 leading-snug">
                  {card.points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span
                        className={`font-mono text-xs shrink-0 mt-0.5 ${
                          card.mode === 'solo' ? 'text-amber-400' : 'text-cyan-400'
                        }`}
                      >
                        —
                      </span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2.5 border-t border-zinc-800/90 flex items-center gap-2 font-mono text-[10.5px] text-zinc-400">
                  <Shield className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span>{card.rosterNote}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
