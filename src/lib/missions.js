/**
 * Missions — the Fire Lab's game layer (3 missions + free play).
 *
 * Every correct answer is computed from the verified data at build time
 * (getVerdict / getLiveVerdict / nearestRowFor) — the questions, the
 * options and the feedback citations all trace to real PSI rows. Nothing
 * is invented, and there are no fake scores: the score is just
 * correct-answers / questions-asked in that mission.
 *
 * Mission flow: the mission tells the player what to set in the lab
 * ("Set the cabin to Exploration and pick SIBAL"). "Apply in the lab"
 * dials those conditions in for them; the quiz unlocks once the lab
 * conditions match the mission target. Mission 3 is open-ended: find
 * ANY fully-TESTED combination yourself, then the quiz checks it.
 */
import {
  ATMOSPHERES, doiFor, fmt, getLiveVerdict, getVerdict, nearestRowFor,
} from './data.js';

function verdictFor(mission) {
  if (mission.target.atmosphereKey) return getVerdict(mission.target.material, mission.target.atmosphereKey);
  return null;
}

/** Mission 1 — SIBAL at Exploration 34%: the headline GAP. */
function mission1() {
  const material = 'SIBAL fabric';
  const atmKey = 'Exploration';
  const v = getVerdict(material, atmKey);
  const issV = getVerdict(material, 'ISS');
  const orionV = getVerdict(material, 'Orion');
  const doi = doiFor(v, 'PSI-99');
  return {
    id: 'm1',
    title: 'Mission 1 — The 34% Question',
    brief: 'Set the cabin to Exploration (34% O₂) and pick SIBAL fabric. Is SIBAL safe up there? Find the nearest real test.',
    target: { material, atmosphereKey: atmKey },
    questions: [
      {
        text: 'SIBAL fabric at Exploration 34% O₂ — what is the verdict?',
        options: ['TESTED', 'GAP', 'PARTIAL'],
        correct: 1,
        explain: `GAP. ${v.o2_nearest_row[0]} · ${v.o2_nearest_row[1]} is the nearest SIBAL test ever run — ${fmt(v.o2_nearest, 1)}% O₂. No SIBAL test in PSI's archive ever ran above 22.1% O₂.`,
      },
      {
        text: 'How far below 34% is the nearest SIBAL test?',
        options: [
          `${fmt(v.o2_distance_pts, 1)} O₂ pts`,
          `${fmt(orionV.o2_distance_pts, 1)} O₂ pts`,
          `${fmt(issV.o2_distance_pts, 1)} O₂ pts`,
        ],
        correct: 0,
        explain: `${fmt(v.o2_distance_pts, 1)} O₂ points. The other options are the same material's numbers at other atmospheres: ${fmt(orionV.o2_distance_pts, 1)} pts at Orion, ${fmt(issV.o2_distance_pts, 1)} pts at ISS.`,
      },
      {
        text: 'Which test is nearest to 34% O₂?',
        options: ['PSI-99 · Sample 2-5', 'PSI-25 · Test T25', 'PSI-69 · FLEX test 20 (192F001)'],
        correct: 0,
        explain: `SAFFIRE-II Sample 2-5 (PSI-99${doi ? `, DOI ${doi}` : ''}) — a cotton-fiberglass (SIBAL) sample at ~22.1% O₂. Test T25 is the nearest at ISS (20.8%); FLEX test 20 is a methanol droplet, not SIBAL.`,
      },
    ],
  };
}

/** Mission 2 — Methanol droplet at Exploration: the pressure gap. */
function mission2() {
  const material = 'Methanol';
  const atmKey = 'Exploration';
  const v = getVerdict(material, atmKey);
  const hepV = getVerdict('Heptane', atmKey);
  const pRow = nearestRowFor(material, 'pressure', v.pressure_nearest_psi);
  const doi = doiFor(v, 'PSI-69');
  return {
    id: 'm2',
    title: 'Mission 2 — Clear the droplet',
    brief: 'Set the cabin to Exploration (34% O₂, 8.2 psi) and pick the methanol droplet. Its O₂ is covered — but is its pressure?',
    target: { material, atmosphereKey: atmKey },
    questions: [
      {
        text: 'Methanol droplet at Exploration — what is the verdict?',
        options: ['TESTED', 'GAP (pressure)', 'GAP (O₂)'],
        correct: 1,
        explain: `GAP (pressure). The O₂ is covered — 9 FLEX rows ran at exactly 34.0% O₂ — but no droplet test ever ran below 10.18 psi.`,
      },
      {
        text: 'How big is the pressure gap?',
        options: [
          `${fmt(v.pressure_distance_psi, 2)} psi`,
          `${fmt(v.pressure_nearest_psi, 2)} psi`,
          `${fmt(hepV.pressure_distance_psi, 2)} psi`,
        ],
        correct: 0,
        explain: `1.98 psi. 10.18 psi is the nearest tested pressure — the level, not the gap. 2.01 psi is heptane's gap, not methanol's.`,
      },
      {
        text: 'That nearest pressure test — FLEX test 121 (C12M101) — ended how?',
        options: ['Extinction', 'Completion', 'Disruption'],
        correct: 0,
        explain: `Extinction — the FLEX table records the test end for every droplet test${doi ? ` (PSI-69, DOI ${doi})` : ''}. The verdict is still a coverage gap, not a burn prediction: the test ran at 10.18 psi, and 8.2 psi was never run.`,
      },
    ],
  };
}

/** Mission 3 — open-ended: find any fully-TESTED combination. */
function mission3() {
  return {
    id: 'm3',
    title: 'Mission 3 — Find a TESTED cabin',
    brief: 'No target is given. Use the sliders and the material picker to find ANY combination that is fully TESTED — then prove it. Hint: droplets were tested at ~10.2 psi. Which atmosphere runs at 10.2 psi?',
    target: null, // open — the player must find a TESTED verdict themselves
    check: (verdict) => verdict.kind === 'TESTED',
    checkFailHint: (verdict) => {
      if (verdict.kind === 'PARTIAL') return 'PARTIAL — O₂ is covered but no PSI table records the pressure for that material. Solids can never be fully TESTED here. Try a droplet.';
      if (verdict.kind === 'GAP_O2') return `GAP — the nearest test is ${fmt(verdict.o2_distance_pts, 1)} O₂ points away. Try a material whose tested O₂ range covers your cabin.`;
      if (verdict.kind === 'GAP_PRESSURE') return `GAP (pressure) — nearest tested pressure is ${fmt(verdict.pressure_nearest_psi, 2)} psi, ${fmt(verdict.pressure_distance_psi, 2)} psi away. Droplets were tested at ~10.2 psi and ~14.7 psi — try an atmosphere that runs at one of those pressures.`;
      return 'NO DATA for that material — pick a material PSI actually tested.';
    },
    questionsFor: (material, verdict) => {
      const invKeys = verdict.doiByInvestigation ? Object.keys(verdict.doiByInvestigation) : [];
      const correctInv = invKeys[0] || 'PSI-69';
      const invLabel = { 'PSI-69': 'PSI-69 · FLEX', 'PSI-25': 'PSI-25 · BASS-II', 'PSI-99': 'PSI-99 · SAFFIRE-II', 'PSI-159': 'PSI-159 · CFI-G' }[correctInv] || `${correctInv}`;
      const distractors = ['PSI-69 · FLEX', 'PSI-25 · BASS-II', 'PSI-99 · SAFFIRE-II'].filter((d) => d !== invLabel);
      const options = [invLabel, ...distractors.slice(0, 2)];
      const atmName = verdict.atmosphere === 'custom'
        ? `${fmt(verdict.o2Target, 1)}% O₂ @ ${fmt(verdict.pressureTarget, 1)} psi`
        : `${ATMOSPHERES[verdict.atmosphere].name} ${ATMOSPHERES[verdict.atmosphere].o2}%`;
      return [
        {
          text: `You found one: ${material} at ${atmName} is TESTED. Which investigation ran the tests that cover it?`,
          options,
          correct: 0,
          explain: `${invLabel} ran the tests covering this condition — every O₂ row for ${material} in PSI comes from there. TESTED means the condition was actually run in microgravity; it is not a flammability certification.`,
        },
      ];
    },
  };
}

export function buildMissions() {
  return [mission1(), mission2(), mission3()];
}

export const MISSIONS = buildMissions();
