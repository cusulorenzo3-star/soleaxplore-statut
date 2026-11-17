#!/usr/bin/env node
// Secours à 15 minutes (décision du propriétaire du 16/11/2026 au soir :
// « Code d'abord, moi en secours » : la séance Code est prévenue tout de suite,
// son iPhone ne sonne que si la panne dure plus de 15 minutes).
//
// Ce script attribue au propriétaire une issue d'Upptime encore ouverte
// 15 minutes après son ouverture. L'attribution fait sonner l'application
// GitHub de son iPhone (« Assignments to issues or pull requests »,
// documentation de GitHub Mobile). Il tourne chez GitHub (Actions), pas sur le
// Mac mini : il marche si le Mac mini est éteint ou si la séance est bloquée.
//
//   ISSUE=N  : lancé par l'ouverture de l'issue N ; attend lui-même la fin des
//              15 minutes, relit l'issue, puis attribue si elle est encore ouverte.
//   sans ISSUE : balayage de toutes les issues ouvertes (filet, toutes les 5 min).
//   ESSAI=true : dit ce qu'il ferait, n'attribue rien.
//
// Variables : GITHUB_TOKEN, GITHUB_REPOSITORY. Banc : node .github/secours/secours.test.js

const DELAI_MS = 15 * 60e3;
const PROPRIETAIRE = 'cusulorenzo3-star';
// Le robot d'Upptime (application GitHub du dépôt). github-actions[bot] : si
// Upptime retombait un jour sur le jeton de secours des Actions. Aucune autre
// personne ne peut ouvrir une issue sous ces deux noms.
const AUTEURS = ['soleaxplore-statut-robot[bot]', 'github-actions[bot]'];

// { oui: true } ou { oui: false, raison, attente? } (attente en ms si trop tôt).
function aSecourir(issue, maintenant) {
  if (!issue || typeof issue !== 'object') return { oui: false, raison: 'issue illisible' };
  if (issue.pull_request) return { oui: false, raison: 'PR, pas une issue' };
  if (issue.state !== 'open') return { oui: false, raison: 'issue fermée' };
  const u = issue.user || {};
  if (u.type !== 'Bot' || !AUTEURS.includes(u.login)) return { oui: false, raison: `ouverte par ${u.login || '?'}, pas par le robot d'Upptime` };
  const etiquettes = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name));
  if (!etiquettes.includes('status')) return { oui: false, raison: 'sans l\'étiquette « status » d\'Upptime' };
  if (/degraded/i.test(String(issue.title || ''))) return { oui: false, raison: 'site lent (« degraded ») : pas une panne' };
  if ((issue.assignees || []).some((a) => a && a.login === PROPRIETAIRE)) return { oui: false, raison: 'déjà attribuée' };
  const age = maintenant - Date.parse(issue.created_at);
  if (!(age >= 0)) return { oui: false, raison: 'date de l\'issue illisible' };
  if (age < DELAI_MS) return { oui: false, raison: 'ouverte depuis moins de 15 minutes', attente: DELAI_MS - age };
  return { oui: true };
}

async function principal({ env = process.env, fetchImpl = fetch, maintenant = () => Date.now(), dormir = (ms) => new Promise((r) => setTimeout(r, ms)), dire = console.log } = {}) {
  const depot = env.GITHUB_REPOSITORY;
  if (!depot || !env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY ou GITHUB_TOKEN absent');
  const essai = String(env.ESSAI || '') === 'true';
  const api = async (chemin, options = {}) => {
    const res = await fetchImpl(`https://api.github.com/repos/${depot}${chemin}`, {
      ...options,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error(`${options.method || 'GET'} ${chemin} : HTTP ${res.status}`);
    return res.json();
  };
  const attribuer = async (issue) => {
    if (essai) { dire(`ESSAI : l'issue ${issue.number} (« ${issue.title} ») serait attribuée à ${PROPRIETAIRE}.`); return 0; }
    await api(`/issues/${issue.number}/assignees`, { method: 'POST', body: JSON.stringify({ assignees: [PROPRIETAIRE] }) });
    // GitHub ignore en silence une attribution impossible : on relit.
    const relue = await api(`/issues/${issue.number}`);
    if (!(relue.assignees || []).some((a) => a && a.login === PROPRIETAIRE)) {
      dire(`ÉCHEC : l'issue ${issue.number} n'est pas attribuée à ${PROPRIETAIRE} après l'appel.`);
      return 1;
    }
    dire(`Issue ${issue.number} (« ${issue.title} ») ouverte le ${issue.created_at}, encore ouverte : attribuée à ${PROPRIETAIRE}, son iPhone est prévenu.`);
    return 0;
  };

  const numero = Number(env.ISSUE || 0);
  if (numero) {
    let issue = await api(`/issues/${numero}`);
    let d = aSecourir(issue, maintenant());
    if (!d.oui && d.attente) {
      dire(`Issue ${numero} : ${d.raison} ; attente de ${Math.ceil(d.attente / 1000)} s.`);
      await dormir(d.attente + 5000);
      issue = await api(`/issues/${numero}`);
      d = aSecourir(issue, maintenant());
    }
    if (!d.oui) { dire(`Issue ${numero} : rien à faire (${d.raison}).`); return 0; }
    return attribuer(issue);
  }

  const issues = await api('/issues?state=open&labels=status&per_page=100');
  if (!Array.isArray(issues)) throw new Error('liste des issues illisible');
  let code = 0;
  let vues = 0;
  for (const issue of issues) {
    const d = aSecourir(issue, maintenant());
    if (d.oui) { vues += 1; code = Math.max(code, await attribuer(issue)); }
  }
  dire(`Balayage : ${issues.length} issue(s) ouverte(s) « status », ${vues} à secourir.`);
  return code;
}

if (require.main === module) {
  principal().then((code) => process.exit(code), (err) => { console.error(`ÉCHEC : ${err.message}`); process.exit(1); });
}

module.exports = { aSecourir, principal, DELAI_MS, PROPRIETAIRE, AUTEURS };
