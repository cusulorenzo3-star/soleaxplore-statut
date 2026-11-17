// Banc du secours à 15 minutes. SIMULATION : l'API de GitHub et l'horloge sont
// remplacées ; rien n'est appelé, rien n'est attribué.
//   node .github/secours/secours.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, 'secours.js'), 'utf8');
let n = 0;
let ko = 0;
function ok(cond, nom) { n += 1; if (cond) console.log(`  ok   ${nom}`); else { ko += 1; console.log(`  ÉCHEC ${nom}`); } }

const T0 = Date.parse('2026-11-17T02:05:00Z');
const MIN = 60e3;
const issueType = (x = {}) => ({ number: 7, state: 'open', title: '🛑 Accueil is down', created_at: '2026-11-17T02:05:00Z', user: { login: 'soleaxplore-statut-robot[bot]', type: 'Bot' }, labels: [{ name: 'status' }, { name: 'accueil' }], assignees: [], ...x });

// Un GitHub simulé : des issues, une horloge, les attributions faites.
function monde({ issues = [issueType()], debut = T0 + 16 * MIN, fermerApresAttente = [], ignorerAttribution = false } = {}) {
  const m = { issues: JSON.parse(JSON.stringify(issues)), heure: debut, appels: [], attributions: [], dormi: 0, journal: [] };
  m.fetchImpl = async (url, opt = {}) => {
    const methode = opt.method || 'GET';
    m.appels.push(`${methode} ${url}`);
    // Une copie, comme la vraie API : un objet déjà lu ne change pas tout seul.
    const rep = (corps, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(corps)) });
    let x;
    if (methode === 'GET' && (x = url.match(/\/issues\/(\d+)$/))) {
      const i = m.issues.find((y) => y.number === Number(x[1]));
      return i ? rep(i) : rep({}, 404);
    }
    if (methode === 'GET' && /\/issues\?state=open&labels=status/.test(url)) return rep(m.issues.filter((i) => i.state === 'open' && i.labels.some((l) => l.name === 'status')));
    if (methode === 'POST' && (x = url.match(/\/issues\/(\d+)\/assignees$/))) {
      const i = m.issues.find((y) => y.number === Number(x[1]));
      m.attributions.push(i.number);
      if (!ignorerAttribution) for (const login of JSON.parse(opt.body).assignees) if (!i.assignees.some((a) => a.login === login)) i.assignees.push({ login });
      return rep(i, 201);
    }
    return rep({}, 404);
  };
  m.dormir = async (ms) => { m.dormi += ms; m.heure += ms; for (const no of fermerApresAttente) m.issues.find((i) => i.number === no).state = 'closed'; };
  m.maintenant = () => m.heure;
  m.dire = (t) => m.journal.push(t);
  return m;
}
const env = (x = {}) => ({ GITHUB_REPOSITORY: 'cusulorenzo3-star/soleaxplore-statut', GITHUB_TOKEN: 'jeton-simule', ...x });
async function lancer(m, e, module = require('./secours.js')) { const code = await module.principal({ env: e, fetchImpl: m.fetchImpl, maintenant: m.maintenant, dormir: m.dormir, dire: m.dire }); return { code, texte: m.journal.join('\n') }; }

(async () => {
  const S = require('./secours.js');
  // 1. La décision, cas par cas.
  const cas = [
    ['issue du robot, ouverte depuis 16 min', issueType(), T0 + 16 * MIN, true],
    ['issue du robot, ouverte depuis 14 min', issueType(), T0 + 14 * MIN, false],
    ['issue fermée', issueType({ state: 'closed' }), T0 + 16 * MIN, false],
    ['issue ouverte par une personne', issueType({ user: { login: 'quelquun', type: 'User' } }), T0 + 16 * MIN, false],
    ['issue ouverte par le compte du propriétaire', issueType({ user: { login: 'cusulorenzo3-star', type: 'User' } }), T0 + 16 * MIN, false],
    ['un autre robot', issueType({ user: { login: 'dependabot[bot]', type: 'Bot' } }), T0 + 16 * MIN, false],
    ['bon nom sans le type Bot', issueType({ user: { login: 'soleaxplore-statut-robot[bot]', type: 'User' } }), T0 + 16 * MIN, false],
    ['jeton de secours des Actions', issueType({ user: { login: 'github-actions[bot]', type: 'Bot' } }), T0 + 16 * MIN, true],
    ['sans l\'étiquette « status »', issueType({ labels: [{ name: 'maintenance' }] }), T0 + 16 * MIN, false],
    ['site lent (degraded)', issueType({ title: '⚠️ Accueil has degraded performance' }), T0 + 16 * MIN, false],
    ['déjà attribuée', issueType({ assignees: [{ login: 'cusulorenzo3-star' }] }), T0 + 16 * MIN, false],
    ['une PR', issueType({ pull_request: {} }), T0 + 16 * MIN, false],
    ['date illisible', issueType({ created_at: 'x' }), T0 + 16 * MIN, false],
    ['datée dans le futur', issueType({ created_at: '2026-11-17T03:00:00Z' }), T0 + 16 * MIN, false],
  ];
  for (const [nom, issue, quand, attendu] of cas) ok(S.aSecourir(issue, quand).oui === attendu, `décision : ${nom} -> ${attendu ? 'secourir' : 'rien'}`);
  ok(Math.round(S.aSecourir(issueType(), T0 + 4 * MIN).attente / MIN) === 11, 'décision : à 4 min, attente de 11 min');

  // 2. Lancé par l'ouverture de l'issue.
  {
    const m = monde({ debut: T0 + 10e3 });
    const r = await lancer(m, env({ ISSUE: '7' }));
    ok(r.code === 0 && m.attributions.join() === '7', 'ouverture : attend, relit, attribue');
    ok(m.dormi >= 15 * MIN - 10e3 && m.dormi <= 15 * MIN, `ouverture : attente jusqu'à 15 min après l'issue (${Math.round(m.dormi / 1000)} s)`);
    ok(m.issues[0].assignees.some((a) => a.login === 'cusulorenzo3-star') && /son iPhone est prévenu/.test(r.texte), 'ouverture : attribution relue et dite');
  }
  {
    const m = monde({ debut: T0 + 10e3, fermerApresAttente: [7] });
    const r = await lancer(m, env({ ISSUE: '7' }));
    ok(r.code === 0 && m.attributions.length === 0 && /issue fermée/.test(r.texte), 'ouverture : panne réglée avant 15 min, rien ne sonne');
  }
  {
    const m = monde({ debut: T0 + 10e3, issues: [issueType({ user: { login: 'quelquun', type: 'User' } })] });
    const r = await lancer(m, env({ ISSUE: '7' }));
    ok(r.code === 0 && m.attributions.length === 0 && m.dormi === 0, 'ouverture : issue d\'une personne, ni attente ni attribution');
  }
  {
    const m = monde({ debut: T0 + 10e3 });
    const r = await lancer(m, env({ ISSUE: '7', ESSAI: 'true' }));
    ok(r.code === 0 && m.attributions.length === 0 && /ESSAI/.test(r.texte), 'essai : dit, n\'attribue rien');
  }
  {
    const m = monde({ debut: T0 + 16 * MIN, ignorerAttribution: true });
    const r = await lancer(m, env({ ISSUE: '7' }));
    ok(r.code === 1 && /ÉCHEC/.test(r.texte), 'attribution ignorée par GitHub : échec visible (passage rouge)');
  }
  // 3. Balayage (filet).
  {
    const issues = [issueType({ number: 1 }), issueType({ number: 2, created_at: '2026-11-17T02:15:00Z' }), issueType({ number: 3, user: { login: 'x', type: 'User' } }), issueType({ number: 4, assignees: [{ login: 'cusulorenzo3-star' }] }), issueType({ number: 5, title: '⚠️ Fiche has degraded performance' })];
    const m = monde({ issues, debut: T0 + 16 * MIN });
    const r = await lancer(m, env());
    ok(r.code === 0 && m.attributions.join() === '1' && m.dormi === 0, `balayage : seule l'issue 1 est attribuée, sans attente (${m.attributions.join() || 'aucune'})`);
  }
  // 4. Le workflow.
  {
    const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'secours-15-min.yml'), 'utf8');
    ok(/^on:\n(?:.*\n)*?\s+issues:\n\s+types: \[opened\]/m.test(wf), 'workflow : lancé par l\'ouverture d\'une issue');
    ok(/schedule:\n\s+- cron: "2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*"/.test(wf), 'workflow : balayage toutes les 5 min, hors début d\'heure');
    ok(/^permissions:\n\s+contents: read\n\s+issues: write$/m.test(wf), 'workflow : droits limités (lecture, issues)');
    ok(wf.split('\n').filter((l) => /^\s+run:/.test(l)).every((l) => !/\$\{\{/.test(l)), 'workflow : aucune donnée recopiée dans la commande (passées par env)');
    ok(/timeout-minutes: 25/.test(wf), 'workflow : arrêt au bout de 25 min');
    ok(/default: true/.test(wf), 'workflow : lancement à la main en essai par défaut');
  }
  const conf = fs.readFileSync(path.join(__dirname, '..', '..', '.upptimerc.yml'), 'utf8');
  ok(!/^assignees:/m.test(conf), '.upptimerc.yml : plus d\'attribution immédiate (retirée avec le secours, dans le même changement)');

  // 5. Contre-épreuves : chaque protection retirée dans une copie ; le cas visé doit mal tourner.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'secours-contre-'));
  const contre = [
    ['les 15 minutes', "  if (age < DELAI_MS) return { oui: false, raison: 'ouverte depuis moins de 15 minutes', attente: DELAI_MS - age };\n", async (C) => { const m = monde({ debut: T0 + 2 * MIN }); await lancer(m, env({ ISSUE: '7' }), C); return m.attributions.length === 1 && m.dormi === 0; }, 'attribuée à 2 min, sans attendre'],
    ['la relecture après l\'attente', "      issue = await api(`/issues/${numero}`);\n", async (C) => { const m = monde({ debut: T0 + 10e3, fermerApresAttente: [7] }); await lancer(m, env({ ISSUE: '7' }), C); return m.attributions.length === 1; }, 'panne réglée pendant l\'attente, attribuée quand même'],
    ['l\'auteur', "  if (u.type !== 'Bot' || !AUTEURS.includes(u.login)) return { oui: false, raison: `ouverte par ${u.login || '?'}, pas par le robot d'Upptime` };\n", async (C) => C.aSecourir(issueType({ user: { login: 'quelquun', type: 'User' } }), T0 + 16 * MIN).oui, 'issue d\'une personne secourue'],
    ['l\'étiquette', "  if (!etiquettes.includes('status')) return { oui: false, raison: 'sans l\\'étiquette « status » d\\'Upptime' };\n", async (C) => C.aSecourir(issueType({ labels: [{ name: 'maintenance' }] }), T0 + 16 * MIN).oui, 'issue sans « status » secourue'],
    ['le site lent', "  if (/degraded/i.test(String(issue.title || ''))) return { oui: false, raison: 'site lent (« degraded ») : pas une panne' };\n", async (C) => C.aSecourir(issueType({ title: '⚠️ Accueil has degraded performance' }), T0 + 16 * MIN).oui, 'site lent secouru'],
    ['issue fermée', "  if (issue.state !== 'open') return { oui: false, raison: 'issue fermée' };\n", async (C) => C.aSecourir(issueType({ state: 'closed' }), T0 + 16 * MIN).oui, 'issue fermée secourue'],
    ['la relecture de l\'attribution', "    if (!(relue.assignees || []).some((a) => a && a.login === PROPRIETAIRE)) {\n", async (C) => { const m = monde({ ignorerAttribution: true }); const r = await lancer(m, env({ ISSUE: '7' }), C); return r.code === 0; }, 'attribution ignorée, passage vert à tort', "    if (false) {\n"],
    ['l\'essai', "    if (essai) { dire(`ESSAI : l'issue ${issue.number} (« ${issue.title} ») serait attribuée à ${PROPRIETAIRE}.`); return 0; }\n", async (C) => { const m = monde(); await lancer(m, env({ ISSUE: '7', ESSAI: 'true' }), C); return m.attributions.length === 1; }, 'l\'essai attribue'],
  ];
  let vues = 0;
  for (const [nom, ligne, mauvais, effet, remplacement = ''] of contre) {
    ok(SOURCE.includes(ligne), `contre-épreuve « ${nom} » : ligne trouvée`);
    const f = path.join(dossier, `copie-${vues}.js`);
    fs.writeFileSync(f, SOURCE.replace(ligne, remplacement));
    const C = require(f);
    ok(await mauvais(C), `contre-épreuve « ${nom} » : sans elle, ${effet} (le banc le voit)`);
    vues += 1;
  }
  console.log(`\nBanc du secours : ${n - ko} sur ${n}${ko ? `, ${ko} EN ÉCHEC` : ''} (dont ${vues} contre-épreuves du code). SIMULATION : API de GitHub et horloge remplacées.`);
  process.exit(ko ? 1 : 0);
})().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
