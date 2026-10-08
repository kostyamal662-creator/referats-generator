// script.js – Essay Generator with Gemini API
// IndexedDB for profiles, mammoth.js for DOCX reading, Gemini API for text generation.

const DB_NAME = 'essayGenDB';
const DB_VERSION = 2;
const PROFILE_STORE = 'profiles';
const API_KEY_STORAGE = 'gemini_api_key';
const VOL_KEY_STORAGE = 'notification_volume';

let db;
let currentProfile = null;
let currentLang = localStorage.getItem('lang') || 'uk';
let notificationVolume = parseFloat(localStorage.getItem(VOL_KEY_STORAGE) || '0.5');

const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';
const MIN_VERIFIED_SOURCES = 5;
const MAX_VERIFIED_SOURCES = 8;
const PREFERRED_FINAL_SOURCES = 5;
const RESEARCH_TERM_ALIASES = [
  { pattern: /уяв|imagin/iu, term: 'imagination' },
  { pattern: /твор|creativ/iu, term: 'creativity' },
  { pattern: /особист|personality/iu, term: 'personality' },
  { pattern: /психолог|psycholog/iu, term: 'psychology' },
  { pattern: /пам.?ят|memor/iu, term: 'memory' },
  { pattern: /мислен|think/iu, term: 'thinking' },
  { pattern: /мотивац|motivat/iu, term: 'motivation' },
  { pattern: /навчан|освіт|learn|educat/iu, term: 'education' },
  { pattern: /комунікац|спілкуван|communicat/iu, term: 'communication' },
  { pattern: /стрес|stress/iu, term: 'stress' },
  { pattern: /філософ.*прав|правов.*філософ/iu, term: 'філософія права' },
  { pattern: /юридичн.*наук|правов.*наук/iu, term: 'юридична наука' },
  { pattern: /верховенств.*прав/iu, term: 'верховенство права' },
  { pattern: /теорі.*держав.*прав|держав.*прав/iu, term: 'теорія держави і права' },
  { pattern: /конституці|constitutional/iu, term: 'конституційне право' },
  { pattern: /кримінал|criminal/iu, term: 'кримінальне право' },
  { pattern: /цивільн.*прав|civil.*law/iu, term: 'цивільне право' },
  { pattern: /адміністратив|administrat/iu, term: 'адміністративне право' },
  { pattern: /правозастосув|правотворч/iu, term: 'правозастосування' },
  { pattern: /правов.*систем/iu, term: 'правова система' },
  { pattern: /герменевтик|hermeneutic/iu, term: 'правова герменевтика' },
  { pattern: /правосвідом|правов.*культур/iu, term: 'правосвідомість' },
  { pattern: /соціолог.*прав/iu, term: 'соціологія права' },
  { pattern: /міжнародн.*прав|international.*law/iu, term: 'міжнародне право' },
  { pattern: /захист.*україн|оборон|збройн|військов/iu, term: 'захист України' },
  { pattern: /економік|economic/iu, term: 'economics' },
  { pattern: /політик|politic/iu, term: 'politics' },
  { pattern: /історі.*держав|історі.*прав/iu, term: 'історія держави і права' },
  { pattern: /екологічн.*прав|environmental.*law/iu, term: 'екологічне право' },
  { pattern: /трудов.*прав|labor.*law/iu, term: 'трудове право' }
];

// The bibliography is intentionally built from catalogue metadata rather than
// copied from the language model. This prevents a fluent-looking but invented
// title, author or DOI from reaching the Word document.
function isAllowedSourceLanguage(work) {
  return (work.language || '').toLowerCase() === 'uk';
}

function hasRussianSourceMarkers(value) {
  return /(російськ|российск|россия|росія|москва|москви|санкт[- ]петербург|рф)/iu.test(value || '');
}

function topicStems(topic) {
  const stopWords = new Set(['для', 'про', 'при', 'після', 'перед', 'щодо', 'через', 'під', 'над', 'між', 'від', 'до', 'за', 'та', 'або', 'і', 'й', 'у', 'в', 'на', 'з', 'із', 'як']);
  const seen = new Set();
  const tokens = String(topic || '')
    .toLocaleLowerCase('uk-UA')
    .match(/[\p{L}]{4,}/gu) || [];

  return tokens
    .filter(token => !stopWords.has(token))
    .map(token => token.slice(0, Math.max(5, token.length - 3)))
    .filter(stem => {
      if (seen.has(stem)) return false;
      seen.add(stem);
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

function hasTopicRelevance(work, stems) {
  if (stems.length === 0) return true;
  const title = String(work?.title || '').toLocaleLowerCase('uk-UA');
  const matches = stems.filter(stem => title.includes(stem));
  const requiredContextStems = stems.filter(stem => stem.startsWith('украї'));

  // When the topic explicitly limits the work to Ukraine, a generic article
  // about the same subject in another context is not an adequate source.
  if (requiredContextStems.some(stem => !title.includes(stem))) return false;

  // For short themes every meaningful word needs to be represented. For
  // longer themes require at least half the stems plus the most specific one.
  if (stems.length <= 2) return matches.length === stems.length;
  if (stems.length <= 4) return title.includes(stems[0]) && matches.length >= stems.length - 1;
  return title.includes(stems[0]) && matches.length >= Math.ceil(stems.length / 2);
}

function researchTermsForTopic(topic) {
  const normalizedTopic = String(topic || '').toLocaleLowerCase('uk-UA');
  return RESEARCH_TERM_ALIASES
    .filter(({ pattern }) => pattern.test(normalizedTopic))
    .map(({ term }) => term)
    .slice(0, 3);
}

function hasResearchTermRelevance(work, researchTerms) {
  if (researchTerms.length === 0) return false;
  const title = String(work?.title || '').toLocaleLowerCase('uk-UA');
  const matches = researchTerms.filter(term => title.toLocaleLowerCase('uk-UA').includes(term.toLocaleLowerCase('uk-UA')));
  return matches.length >= 1;
}

function partialTopicMatchCount(work, stems) {
  const title = String(work?.title || '').toLocaleLowerCase('uk-UA');
  return stems.filter(stem => title.includes(stem)).length;
}

function sourceLinkFor(work) {
  return work.doi || work.primary_location?.landing_page_url || work.open_access?.oa_url || work.id || '';
}

function initialsFromNames(names) {
  return names
    .map(name => name.replace(/[^\p{L}]/gu, '').trim())
    .filter(Boolean)
    .map(name => `${name[0].toLocaleUpperCase('uk-UA')}.`)
    .join(' ');
}

function looksLikeUkrainianSurname(value) {
  return /(енко|чук|щук|юк|ук|ко|ак|як|ська|зька|цька|ський|зький|цький|ова|ева|іна|ина|ов|ев|ін|ець|ич|ій|аш|иш)$/iu.test(value || '');
}

function normalizeAuthorNameCase(name) {
  if (!name) return '';
  // Always fix individual words that are entirely UPPER CASE (2+ letters),
  // even when the rest of the name already has mixed case.
  return name.split(/([\s,.-]+)/).map(part => {
    if (/^[\p{Lu}]{2,}$/u.test(part)) {
      return part.charAt(0).toLocaleUpperCase('uk-UA') + part.slice(1).toLocaleLowerCase('uk-UA');
    }
    return part;
  }).join('');
}

function formatAuthorForBibliography(rawName) {
  let name = String(rawName || '').replace(/\s+/g, ' ').trim();
  name = normalizeAuthorNameCase(name);
  if (!name) return '';

  // Catalogue records contain both "І. М. Берназюк" and
  // "Берназюк І. М." variants. Convert either to the format shown in the
  // supplied sample: surname first, then initials.
  const initialsFirst = name.match(/^((?:[\p{Lu}]\.\s*){1,3})([\p{L}'’\-]+)$/u);
  if (initialsFirst) {
    const initials = initialsFirst[1].match(/[\p{Lu}]/gu)?.map(letter => `${letter}.`).join(' ') || '';
    return `${initialsFirst[2]} ${initials}`.trim();
  }

  if (name.includes(',')) {
    const [surname, givenNames] = name.split(',', 2);
    return `${surname.trim()} ${initialsFromNames((givenNames || '').trim().split(/\s+/))}`.trim();
  }

  const words = name.split(' ').filter(Boolean);
  if (words.length === 1) return words[0];

  const surnameIsFirst = looksLikeUkrainianSurname(words[0]);
  const surname = surnameIsFirst ? words[0] : words.at(-1);
  const givenNames = surnameIsFirst ? words.slice(1) : words.slice(0, -1);
  return `${surname} ${initialsFromNames(givenNames)}`.trim();
}

function sourceAuthorsFor(work) {
  const authors = (work.authorships || [])
    .map(({ raw_author_name, author }) => raw_author_name || author?.display_name || '')
    .map(formatAuthorForBibliography)
    .filter(Boolean)
    .slice(0, 3);

  if (authors.length === 0) return 'Без автора';
  return authors.join(', ') + ((work.authorships || []).length > authors.length ? ' та ін.' : '');
}

function sourceSortKey(work) {
  const firstAuthor = work.authorships?.[0]?.raw_author_name || work.authorships?.[0]?.author?.display_name || '';
  return formatAuthorForBibliography(firstAuthor).toLocaleLowerCase('uk-UA') || String(work.title || '').toLocaleLowerCase('uk-UA');
}

function trimTerminalPunctuation(value) {
  return String(value || '').trim().replace(/[.\s]+$/u, '');
}

function formatJournalDetails(work) {
  const biblio = work.biblio || {};
  // ДСТУ 8302:2015: volume and issue joined with ", ", pages separated by ". "
  const volumeIssue = [];
  if (biblio.volume) volumeIssue.push(`Т. ${biblio.volume}`);
  if (biblio.issue) volumeIssue.push(`№ ${biblio.issue}`);
  const pageRange = biblio.first_page
    ? `С. ${biblio.first_page}${biblio.last_page && biblio.last_page !== biblio.first_page ? `–${biblio.last_page}` : ''}`
    : '';
  const parts = [];
  if (volumeIssue.length) parts.push(volumeIssue.join(', '));
  if (pageRange) parts.push(pageRange);
  return parts.join('. ');
}

function capitalizeProperNouns(text) {
  // Re-capitalize Ukrainian proper nouns after sentence-casing
  const roots = ['україн', 'київ', 'євро', 'одес', 'харків', 'львів', 'крив', 'запоріж', 'дніпр', 'хмельниц', 'полтав', 'чернігів', 'черкас', 'вінниц', 'тернопіл', 'миколаїв', 'херсон'];
  let result = text;
  for (const root of roots) {
    const re = new RegExp(`(${root})`, 'giu');
    result = result.replace(re, match => match.charAt(0).toLocaleUpperCase('uk-UA') + match.slice(1));
  }
  return result;
}

function normalizeTitleCase(text) {
  // If the entire title is UPPER CASE, convert to sentence case.
  if (!text) return '';
  const hasLowerCase = /[\p{Ll}]/u.test(text);
  if (hasLowerCase) return text; // already mixed case, leave as is
  // Convert to sentence case: first letter uppercase, rest lowercase
  let result = text.charAt(0).toLocaleUpperCase('uk-UA') + text.slice(1).toLocaleLowerCase('uk-UA');
  // Restore capitalization for proper nouns (Україні, Київ, Європейський, etc.)
  return capitalizeProperNouns(result);
}

function formatVerifiedSource(work) {
  // For journal articles OpenAlex provides author, title, journal, year and
  // often volume/issue/pages. These fields form a conventional bibliographic
  // record. Technical catalogue links remain in memory for verification but do
  // not clutter the student-facing list with URLs or DOI strings.
  const rawTitle = String(work.title || '');
  const title = normalizeTitleCase(rawTitle);
  // Prefer the name that contains Cyrillic characters for Ukrainian bibliography
  const rawSourceName = work.primary_location?.raw_source_name || '';
  const displayName = work.primary_location?.source?.display_name || '';
  const hasCyrillic = s => /[\p{Script=Cyrillic}]/u.test(s);
  let rawPublication = '';
  if (hasCyrillic(rawSourceName) && !/^[\d\-xX]{8,9}$/.test(rawSourceName.trim())) {
    rawPublication = rawSourceName;
  } else if (hasCyrillic(displayName)) {
    rawPublication = displayName;
  } else {
    rawPublication = rawSourceName || displayName;
    if (/^[\d\-xX]{8,9}$/.test(rawPublication.trim())) rawPublication = '';
  }
  const publication = normalizeTitleCase(rawPublication);
  const year = work.publication_year || 'б. р.';
  const details = formatJournalDetails(work);
  const publicationPart = publication ? ` ${trimTerminalPunctuation(publication)}.` : '';
  const detailsPart = details ? ` ${details}.` : '';

  return `${trimTerminalPunctuation(sourceAuthorsFor(work))}. ${trimTerminalPunctuation(title)}.${publicationPart} ${year}.${detailsPart}`
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isUsableCatalogueWork(work) {
  // Keep automatic references to publications with enough fields to make a
  // complete-looking entry without guessing a publisher or page count.
  const allowedTypes = new Set(['article', 'review']);
  const metadata = [
    work.title,
    work.primary_location?.source?.display_name,
    work.primary_location?.raw_source_name,
    ...(work.authorships || []).map(item => item.raw_author_name || item.author?.display_name || '')
  ].join(' ');

  return Boolean(
    work &&
    !work.is_retracted &&
    allowedTypes.has(work.type) &&
    isAllowedSourceLanguage(work) &&
    work.title &&
    /[А-ЯІЇЄҐ]/iu.test(work.title) &&
    work.publication_year &&
    (work.primary_location?.raw_source_name || work.primary_location?.source?.display_name) &&
    work.primary_location?.source?.type === 'journal' &&
    sourceLinkFor(work) &&
    !hasRussianSourceMarkers(metadata)
  );
}

async function searchCatalogue(query) {
  const url = `${OPENALEX_WORKS_URL}?search=${encodeURIComponent(query)}&per-page=50&mailto=contact@referats.com`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 429) return [];
    throw new Error(`Каталог джерел тимчасово недоступний (${response.status}).`);
  }
  return (await response.json()).results || [];
}

function catalogueSourceFrom(work) {
  return {
    id: work.id,
    citation: formatVerifiedSource(work),
    language: work.language,
    citedBy: Number(work.cited_by_count) || 0,
    verificationUrl: sourceLinkFor(work),
    sortKey: sourceSortKey(work)
  };
}

function addVerifiedCatalogueWorks(target, usedTitles, works, predicate) {
  for (const work of works) {
    if (!isUsableCatalogueWork(work) || !predicate(work)) continue;
    const titleKey = work.title.trim().toLocaleLowerCase('uk-UA');
    if (usedTitles.has(titleKey)) continue;

    usedTitles.add(titleKey);
    target.push(catalogueSourceFrom(work));
    if (target.length === MAX_VERIFIED_SOURCES) break;
  }
}

async function getVerifiedSources(topic) {
  const query = topic
    .replace(/[^\p{L}\p{N}\s''\u2010-\u2014-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  if (!query) return [];

  const works = await searchCatalogue(query);
  const stems = topicStems(query);
  const usedTitles = new Set();
  const verified = [];

  // First pass: strict match
  addVerifiedCatalogueWorks(verified, usedTitles, works, work => hasTopicRelevance(work, stems));

  // Second pass: related research terms
  if (verified.length < MIN_VERIFIED_SOURCES) {
    const researchTerms = researchTermsForTopic(query);
    if (researchTerms.length > 0) {
      for (const term of researchTerms) {
        if (verified.length >= MAX_VERIFIED_SOURCES) break;
        const relatedWorks = await searchCatalogue(term);
        addVerifiedCatalogueWorks(
          verified, usedTitles, relatedWorks,
          work => hasResearchTermRelevance(work, [term])
        );
      }
    }
  }

  // Third pass: sub-queries from topic words
  if (verified.length < MIN_VERIFIED_SOURCES) {
    const words = query.split(/\s+/).filter(w => w.length >= 4);
    const subQueries = new Set();
    if (words.length >= 4) {
      const mid = Math.ceil(words.length / 2);
      subQueries.add(words.slice(0, mid).join(' '));
      subQueries.add(words.slice(mid).join(' '));
    }
    if (words.length >= 2) {
      subQueries.add(`${words[0]} ${words[words.length - 1]}`);
    }
    for (const subQ of subQueries) {
      if (verified.length >= MAX_VERIFIED_SOURCES) break;
      const subWorks = await searchCatalogue(subQ);
      addVerifiedCatalogueWorks(
        verified, usedTitles, subWorks,
        work => partialTopicMatchCount(work, stems) >= (stems.length > 2 ? 2 : 1)
      );
    }
  }

  // Last fallback: partial matches from original search
  if (verified.length < MIN_VERIFIED_SOURCES) {
    const partiallyRelevantWorks = works
      .filter(isUsableCatalogueWork)
      .sort((a, b) => partialTopicMatchCount(b, stems) - partialTopicMatchCount(a, stems));
    addVerifiedCatalogueWorks(
      verified, usedTitles, partiallyRelevantWorks,
      work => partialTopicMatchCount(work, stems) >= (stems.length > 2 ? 2 : 1)
    );
  }

  return verified.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'uk-UA'));
}

function bibliographyFrom(verifiedSources) {
  return verifiedSources
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'uk-UA'))
    .map(source => sanitizeGeneratedText(source.citation));
}

function chooseSourcesForEssay(candidates, sourceIds) {
  const sourceByCode = new Map(candidates.map((source, index) => [`S${index + 1}`, source]));
  const selected = [];
  const seenCodes = new Set();

  if (Array.isArray(sourceIds)) {
    for (const code of sourceIds) {
      const normalizedCode = String(code || '').trim().toUpperCase();
      const source = sourceByCode.get(normalizedCode);
      if (source && !seenCodes.has(normalizedCode)) {
        selected.push({ ...source, code: normalizedCode });
        seenCodes.add(normalizedCode);
      }
      if (selected.length === PREFERRED_FINAL_SOURCES) break;
    }
  }

  // The fallback is deliberately short: it is safer to include four verified
  // records than pad a bibliography with a model-generated list.
  if (selected.length < MIN_VERIFIED_SOURCES) {
    return candidates
      .slice(0, PREFERRED_FINAL_SOURCES)
      .map((source, index) => ({ ...source, code: `S${index + 1}` }));
  }

  return selected;
}

function sanitizeGeneratedText(value) {
  if (typeof value !== 'string') return value || '';

  // Use an ordinary hyphen throughout and strip only reference-like brackets.
  return value
    .replace(/\s*[–—]\s*/gu, ' - ')
    .replace(/[‐‑‒―]/gu, '-')
    .replace(/\[\[S\d+\]\]/giu, '')
    .replace(/\s*\[[\s\d,;.\-–—сCpP]+\]\s*/gu, ' ')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}

function sanitizeEssayContent(essayData) {
  essayData.intro = sanitizeGeneratedText(essayData.intro);
  essayData.conclusion = sanitizeGeneratedText(essayData.conclusion);
  (essayData.sections || []).forEach(section => {
    section.title = sanitizeGeneratedText(section.title);
    section.text = sanitizeGeneratedText(section.text);
    (section.subsections || []).forEach(subsection => {
      subsection.title = sanitizeGeneratedText(subsection.title);
      subsection.text = sanitizeGeneratedText(subsection.text);
    });
  });
  return essayData;
}

function isConclusionLikeTitle(value) {
  return /\b(виснов|підсум|заключен|conclusion|summary)\b/iu.test(String(value || ''));
}

function hasSectionContent(section) {
  if (String(section?.text || '').trim().length > 80) return true;
  return (section?.subsections || []).some(subsection => String(subsection?.text || '').trim().length > 80);
}

function normalizeEssayStructure(essayData) {
  const sections = Array.isArray(essayData.sections) ? essayData.sections : [];
  const usableSections = sections.filter(section => hasSectionContent(section));
  const conclusionSection = usableSections.find(section => isConclusionLikeTitle(section?.title));

  // Models sometimes put conclusions into a fourth section. Move its body to
  // the real conclusion only if no dedicated conclusion has been returned.
  if (!String(essayData.conclusion || '').trim() && conclusionSection) {
    const pieces = [conclusionSection.text, ...(conclusionSection.subsections || []).map(sub => sub.text)]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    essayData.conclusion = pieces.join('\n\n');
  }

  essayData.sections = usableSections
    .filter(section => !isConclusionLikeTitle(section?.title))
    .slice(0, 3);
  return essayData;
}

// ─── IndexedDB ───────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE)) {
        database.createObjectStore(PROFILE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(); };
    request.onerror = (e) => reject(e);
  });
}

function getAllProfiles() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readonly');
    const req = tx.objectStore(PROFILE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function addProfileToDB(name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).add({ name, requirements: [] });
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function deleteProfileFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

function updateProfileInDB(profile) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    const req = tx.objectStore(PROFILE_STORE).put(profile);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

// ─── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  await openDB();

  // Profile controls
  document.getElementById('add-profile').addEventListener('click', onAddProfile);
  document.getElementById('rename-profile').addEventListener('click', onRenameProfile);
  document.getElementById('delete-profile').addEventListener('click', onDeleteProfile);
  document.getElementById('profile-select').addEventListener('change', onProfileChange);

  // Export/Import
  document.getElementById('export-data').addEventListener('click', exportAllData);
  document.getElementById('import-data').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', importAllData);

  // File upload
  document.getElementById('file-input').addEventListener('change', onFilesSelected);
  document.getElementById('example-input').addEventListener('change', onExampleSelected);
  document.getElementById('file-upload-box').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('example-upload-box').addEventListener('click', () => document.getElementById('example-input').click());

  // Language
  document.getElementById('lang-toggle').addEventListener('click', toggleLanguage);

  // Load and save toggle states (settings)
  const toggles = ['citations-toggle', 'lite-model-toggle', 'hyphenation-toggle'];
  toggles.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const saved = localStorage.getItem(id);
      if (saved !== null) {
        el.checked = saved === 'true';
      }
      el.addEventListener('change', () => {
        localStorage.setItem(id, el.checked);
      });
    }
  });

  const positionSelect = document.getElementById('page-number-position');
  if (positionSelect) {
    const savedPos = localStorage.getItem('page-number-position');
    if (savedPos) {
      positionSelect.value = savedPos;
    }
    positionSelect.addEventListener('change', () => {
      localStorage.setItem('page-number-position', positionSelect.value);
    });
  }

  // Margin inputs — save per profile
  const marginIds = ['margin-top', 'margin-bottom', 'margin-left', 'margin-right'];
  marginIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        if (currentProfile) {
          if (!currentProfile.margins) currentProfile.margins = {};
          currentProfile.margins[id] = parseInt(el.value) || 20;
          await updateProfileInDB(currentProfile);
        }
      });
    }
  });

  // Generation & export
  document.getElementById('generate-btn').addEventListener('click', generateEssay);
  document.getElementById('export-docx').addEventListener('click', exportDocx);
  document.getElementById('print-pdf').addEventListener('click', () => window.print());

  // Settings modal
  document.getElementById('settings-toggle').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    const savedKey = localStorage.getItem(API_KEY_STORAGE) || '';
    document.getElementById('api-key-input').value = savedKey;
    document.getElementById('volume-slider').value = notificationVolume;
    updateApiStatus();
  });
  document.getElementById('close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('modal-backdrop')?.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('save-api-key').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      localStorage.setItem(API_KEY_STORAGE, key);
      document.getElementById('api-status').textContent = i18n.apiKeySaved[currentLang];
      document.getElementById('api-status').className = 'status-badge mt-2 status-ok';
    }
  });

  // Volume slider
  document.getElementById('volume-slider').addEventListener('input', (e) => {
    notificationVolume = parseFloat(e.target.value);
    localStorage.setItem(VOL_KEY_STORAGE, notificationVolume);
  });
  
  // Test sound button
  document.getElementById('test-sound-btn').addEventListener('click', () => {
    playNotificationSound(notificationVolume);
  });

  // Backdrop click to close modal
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      el.parentElement.classList.add('hidden');
    });
  });

  applyI18n();
  updateApiStatus();

  // Restore topic
  const savedTopic = localStorage.getItem('essay_topic') || '';
  document.getElementById('topic-input').value = savedTopic;

  // Save topic on input
  document.getElementById('topic-input').addEventListener('input', (e) => {
    localStorage.setItem('essay_topic', e.target.value);
  });

  // Restore and save discipline
  const savedDiscipline = localStorage.getItem('essay_discipline') || '';
  const disciplineInput = document.getElementById('discipline-input');
  if (disciplineInput) {
    disciplineInput.value = savedDiscipline;
    disciplineInput.addEventListener('input', (e) => {
      localStorage.setItem('essay_discipline', e.target.value);
    });
  }

  // Restore and save page count
  const savedPageCount = localStorage.getItem('essay_page_count');
  const pageCountInput = document.getElementById('page-count');
  if (pageCountInput) {
    if (savedPageCount) pageCountInput.value = savedPageCount;
    pageCountInput.addEventListener('change', (e) => {
      localStorage.setItem('essay_page_count', e.target.value);
    });
  }

  await refreshProfileList();
});

// ─── Export / Import ─────────────────────────────────────────

async function exportAllData() {
  const profiles = await getAllProfiles();
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    apiKey: localStorage.getItem('referats_api_key') || '',
    settings: {
      'page-number-position': localStorage.getItem('page-number-position') || 'bottom-right',
      'citations-toggle': localStorage.getItem('citations-toggle') || 'false',
      'lite-model-toggle': localStorage.getItem('lite-model-toggle') || 'false',
      'hyphenation-toggle': localStorage.getItem('hyphenation-toggle') || 'true',
      'essay_topic': localStorage.getItem('essay_topic') || '',
      'essay_discipline': localStorage.getItem('essay_discipline') || '',
      'essay_page_count': localStorage.getItem('essay_page_count') || '15',
      'last_profile_id': localStorage.getItem('last_profile_id') || '',
      'notification_volume': localStorage.getItem('notification_volume') || '0.5',
    },
    profiles: profiles
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'referats_backup.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert('✅ Експорт завершено! Збережіть файл referats_backup.json у папку Referats.');
}

async function importAllData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.profiles || !Array.isArray(data.profiles)) {
      alert('❌ Невірний формат файлу!');
      return;
    }

    if (!confirm('Імпорт замінить всі поточні профілі та налаштування. Продовжити?')) return;

    // Restore API key
    if (data.apiKey) {
      localStorage.setItem('referats_api_key', data.apiKey);
    }

    // Restore settings
    if (data.settings) {
      Object.entries(data.settings).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          localStorage.setItem(key, value);
        }
      });
    }

    // Clear existing profiles and import new ones
    const existingProfiles = await getAllProfiles();
    for (const p of existingProfiles) {
      await deleteProfileFromDB(p.id);
    }

    for (const profile of data.profiles) {
      const { id, ...profileData } = profile;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PROFILE_STORE, 'readwrite');
        const req = tx.objectStore(PROFILE_STORE).add(profileData);
        req.onsuccess = () => resolve();
        req.onerror = (err) => reject(err);
      });
    }

    alert('✅ Імпорт завершено! Сторінка буде перезавантажена.');
    location.reload();
  } catch (err) {
    alert('❌ Помилка імпорту: ' + err.message);
  }
}

// ─── Profile Management ─────────────────────────────────────

async function refreshProfileList() {
  const select = document.getElementById('profile-select');
  const profiles = await getAllProfiles();
  select.innerHTML = '';

  if (profiles.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = currentLang === 'uk' ? '— Немає профілів —' : '— Нет профилей —';
    select.appendChild(opt);
    currentProfile = null;
    renderFileList();
    return;
  }

  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  // If we had a profile selected or saved, try to keep it
  let targetId = currentProfile ? currentProfile.id : Number(localStorage.getItem('last_profile_id'));
  if (targetId) {
    const exists = profiles.find(p => p.id === targetId);
    if (exists) {
      select.value = exists.id;
      currentProfile = exists;
    } else {
      select.value = profiles[0].id;
      currentProfile = profiles[0];
    }
  } else {
    select.value = profiles[0].id;
    currentProfile = profiles[0];
  }
  
  if (currentProfile) {
    localStorage.setItem('last_profile_id', currentProfile.id);
  }

  renderFileList();
  loadMarginsFromProfile();
}

async function onAddProfile() {
  const profiles = await getAllProfiles();
  if (profiles.length >= 20) {
    alert(currentLang === 'uk' ? 'Максимум 20 профілів' : 'Максимум 20 профилей');
    return;
  }
  const name = prompt(i18n.addProfilePrompt[currentLang]);
  if (!name || !name.trim()) return;
  await addProfileToDB(name.trim());
  await refreshProfileList();
}

async function onRenameProfile() {
  if (!currentProfile) return;
  const newName = prompt(i18n.renamePrompt[currentLang], currentProfile.name);
  if (!newName || !newName.trim()) return;
  currentProfile.name = newName.trim();
  await updateProfileInDB(currentProfile);
  await refreshProfileList();
}

async function onDeleteProfile() {
  if (!currentProfile) return;
  if (!confirm(i18n.deleteConfirm[currentLang])) return;
  await deleteProfileFromDB(currentProfile.id);
  currentProfile = null;
  await refreshProfileList();
}

async function onProfileChange(e) {
  const id = Number(e.target.value);
  if (!id) { 
    currentProfile = null; 
    localStorage.removeItem('last_profile_id');
    renderFileList(); 
    return; 
  }
  const profiles = await getAllProfiles();
  currentProfile = profiles.find(p => p.id === id) || null;
  if (currentProfile) {
    localStorage.setItem('last_profile_id', currentProfile.id);
  }
  renderFileList();
  renderExampleFile();
  loadMarginsFromProfile();
}

function loadMarginsFromProfile() {
  const defaults = { 'margin-top': 20, 'margin-bottom': 20, 'margin-left': 20, 'margin-right': 10 };
  const margins = (currentProfile && currentProfile.margins) || {};
  Object.keys(defaults).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = margins[id] !== undefined ? margins[id] : defaults[id];
  });
}

// ─── File Upload & Display ───────────────────────────────────

function renderFileList() {
  const container = document.getElementById('file-list');
  container.innerHTML = '';

  if (!currentProfile || !currentProfile.requirements || currentProfile.requirements.length === 0) {
    container.innerHTML = `<p class="no-files">${i18n.noFiles[currentLang]}</p>`;
    return;
  }

  currentProfile.requirements.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const icon = file.name.endsWith('.docx') ? '📄' : file.name.endsWith('.pdf') ? '📕' : '📝';
    const sizeBytes = file.content ? file.content.length : 0;
    const sizeKB = sizeBytes >= 1024 ? Math.round(sizeBytes / 1024) + ' КБ' : (sizeBytes > 0 ? '< 1 КБ' : '0 КБ');

    item.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${sizeKB} тексту</span>
      <button class="btn-remove" data-idx="${idx}" title="${i18n.removeFile[currentLang]}">✕</button>
    `;
    container.appendChild(item);
  });

  // Attach remove handlers
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = Number(e.target.dataset.idx);
      currentProfile.requirements.splice(idx, 1);
      await updateProfileInDB(currentProfile);
      renderFileList();
    });
  });
}

// ─── Example Referat ─────────────────────────────────────────

function renderExampleFile() {
  const container = document.getElementById('example-file-display');
  if (!container) return;
  container.innerHTML = '';

  if (!currentProfile || !currentProfile.examples || currentProfile.examples.length === 0) {
    return;
  }

  currentProfile.examples.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const sizeBytes = file.content ? file.content.length : 0;
    const sizeKB = sizeBytes >= 1024 ? Math.round(sizeBytes / 1024) + ' КБ' : (sizeBytes > 0 ? '< 1 КБ' : '0 КБ');
    item.innerHTML = `
      <span class="file-icon">📋</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${sizeKB} тексту</span>
      <button class="btn-remove" data-ex-idx="${idx}" title="${i18n.removeFile[currentLang]}">✕</button>
    `;
    container.appendChild(item);
  });

  // Attach remove handlers
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = Number(e.target.dataset.exIdx);
      currentProfile.examples.splice(idx, 1);
      await updateProfileInDB(currentProfile);
      renderExampleFile();
    });
  });
}

async function onExampleSelected(e) {
  try {
    const files = Array.from(e.target.files);
    if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);
    if (files.length === 0) return;

    if (!currentProfile.examples) currentProfile.examples = [];

    for (const f of files) {
      if (currentProfile.examples.length >= 3) {
        alert(i18n.maxExamplesAlert[currentLang] || 'Maximum 3 examples allowed');
        break;
      }
      const result = await readSingleFile(f);
      if (result && result.buffer) {
        currentProfile.examples.push(result);
      }
    }

    await updateProfileInDB(currentProfile);
    renderExampleFile();
    document.getElementById('example-input').value = '';
  } catch (err) {
    alert("Помилка під час завантаження зразків: " + (err.message || err));
    console.error(err);
  }
}
function readSingleFile(f) {
  return new Promise((resolve) => {
    const ext = f.name.split('.').pop().toLowerCase();

    if (ext === 'doc') {
      const reader = new FileReader();
      reader.onload = function (event) {
        try {
          const buffer = event.target.result;
          const bytes = new Uint8Array(buffer);
          let unicodeText = '';
          let asciiText = '';
          let currentRun = '';
          for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if ((b >= 0x20 && b <= 0x7E) || b === 0x0A || b === 0x0D || b === 0x09 || (b >= 0xC0 && b <= 0xFF) || b === 0xA8 || b === 0xB8) {
              currentRun += String.fromCharCode(b);
            } else {
              if (currentRun.length >= 4) { asciiText += currentRun + '\n'; }
              currentRun = '';
            }
          }
          if (currentRun.length >= 4) asciiText += currentRun;
          let utf16Text = '';
          let utf16Run = '';
          for (let i = 0; i < bytes.length - 1; i += 2) {
            const code = bytes[i] | (bytes[i + 1] << 8);
            if ((code >= 0x20 && code <= 0x7E) || (code >= 0x0400 && code <= 0x04FF) ||
              code === 0x0A || code === 0x0D || code === 0x09 ||
              (code >= 0xAB && code <= 0xBB) || code === 0x2014 || code === 0x2013 ||
              code === 0x2018 || code === 0x2019 || code === 0x201C || code === 0x201D) {
              utf16Run += String.fromCharCode(code);
            } else {
              if (utf16Run.length >= 4) { utf16Text += utf16Run + '\n'; }
              utf16Run = '';
            }
          }
          if (utf16Run.length >= 4) utf16Text += utf16Run;

          const cyrillicCountAscii = (asciiText.match(/[\u0400-\u04FF]/g) || []).length;
          const cyrillicCountUtf16 = (utf16Text.match(/[\u0400-\u04FF]/g) || []).length;
          let text = cyrillicCountUtf16 > cyrillicCountAscii ? utf16Text : asciiText;

          if ((text.match(/[\u0400-\u04FF]/g) || []).length < 10) {
            const win1251 = new TextDecoder('windows-1251');
            const decoded = win1251.decode(buffer);
            let decodedRuns = '';
            let dRun = '';
            for (const ch of decoded) {
              const code = ch.charCodeAt(0);
              if ((code >= 0x20 && code <= 0x7E) || (code >= 0x0400 && code <= 0x04FF) ||
                code === 0x0A || code === 0x0D || code === 0x09 ||
                ch === '«' || ch === '»' || ch === '—' || ch === '–' || ch === '\u0456' || ch === '\u0457' || ch === '\u0454' || ch === '\u0491') {
                dRun += ch;
              } else {
                if (dRun.length >= 4) decodedRuns += dRun + '\n';
                dRun = '';
              }
            }
            if (dRun.length >= 4) decodedRuns += dRun;
            if ((decodedRuns.match(/[\u0400-\u04FF]/g) || []).length > (text.match(/[\u0400-\u04FF]/g) || []).length) {
              text = decodedRuns;
            }
          }
          text = text.replace(/\n{3,}/g, '\n\n').trim();
          resolve({ name: f.name, content: text, buffer: buffer });
        } catch (err) {
          console.error('DOC read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else if (ext === 'docx') {
      const reader = new FileReader();
      reader.onload = async function (event) {
        try {
          const arrayBuffer = event.target.result;
          let text = '';
          try {
            const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer.slice(0) });
            text = result.value || '';
            // Strip out excessively heavy HTML tags to save tokens, but keep structure (h1, h2, p, li)
            text = text.replace(/<(?!h[1-6]|p|ul|ol|li|strong|b|i|em|\/)[^>]+>/gi, '');
          } catch (e) {
            console.error('Mammoth error:', e);
          }
          if (!text || text.trim().length < 30) {
            try {
              const zip = await JSZip.loadAsync(arrayBuffer.slice(0));
              let fullText = '';
              const docFile = zip.file("word/document.xml");
              if (docFile) {
                const xml = await docFile.async("string");
                const parser = new DOMParser();
                const doc = parser.parseFromString(xml, 'text/xml');
                const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
                const paragraphs = doc.getElementsByTagNameNS(ns, 'p');
                const lines = [];
                for (const para of paragraphs) {
                  const runs = para.getElementsByTagNameNS(ns, 't');
                  const lineText = Array.from(runs).map(r => r.textContent).join('');
                  if (lineText.trim()) lines.push(lineText.trim());
                }
                fullText = lines.join('\n');
              }
              text = fullText || text;
            } catch (zipErr) {
              console.error('JSZip fallback error:', zipErr);
            }
          }
          resolve({ name: f.name, content: text, buffer: arrayBuffer });
        } catch (err) {
          console.error('DOCX read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else if (ext === 'pdf') {
      const reader = new FileReader();
      reader.onload = async function (event) {
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const pdf = await pdfjsLib.getDocument({ data: event.target.result.slice(0) }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
          }
          resolve({ name: f.name, content: text, buffer: event.target.result });
        } catch (err) {
          console.error('PDF read error:', err);
          resolve({ name: f.name, content: '', buffer: null });
        }
      };
      reader.readAsArrayBuffer(f);
    } else {
      f.text().then(content => {
        f.arrayBuffer().then(buffer => {
          resolve({ name: f.name, content, buffer });
        });
      });
    }
  });
}

async function onFilesSelected(e) {
  try {
    const files = Array.from(e.target.files);
    if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);

    const currentCount = currentProfile.requirements ? currentProfile.requirements.length : 0;
    if (currentCount + files.length > 5) {
      alert(i18n.maxFilesAlert[currentLang]);
      return;
    }

    const readPromises = files.map(f => readSingleFile(f));

    const results = await Promise.all(readPromises);
    const validResults = results.filter(r => r.buffer);

    if (!currentProfile.requirements) currentProfile.requirements = [];

    for (const r of validResults) {
      currentProfile.requirements.push(r);
    }

    await updateProfileInDB(currentProfile);

    // Reset file input
    document.getElementById('file-input').value = '';
    renderFileList();
  } catch (err) {
    alert("Помилка під час завантаження вимог: " + (err.message || err));
    console.error(err);
  }
}

// ─── Language ────────────────────────────────────────────────

function toggleLanguage() {
  currentLang = currentLang === 'uk' ? 'ru' : 'uk';
  localStorage.setItem('lang', currentLang);
  applyI18n();
  renderFileList();
  updateApiStatus();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[key] && i18n[key][currentLang]) {
      el.textContent = i18n[key][currentLang];
    }
  });
  document.getElementById('lang-toggle').textContent = i18n.langLabel[currentLang];
}

function updateApiStatus() {
  const status = document.getElementById('api-status');
  if (!status) return;
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (key) {
    status.textContent = i18n.apiKeySet[currentLang];
    status.className = 'status-badge mt-2 status-ok';
  } else {
    status.textContent = i18n.apiKeyMissing[currentLang];
    status.className = 'status-badge mt-2 status-err';
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ─── Notifications ─────────────────────────────────────────────
function playNotificationSound(volumeLevel) {
  if (volumeLevel <= 0) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volumeLevel, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch(e) {
    console.error("Audio error:", e);
  }
}

function sendNotification(title, body, isError = false) {
  playNotificationSound(notificationVolume);

  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-body">${escapeHtml(body)}</div>
  `;
  
  container.appendChild(toast);
  
  // Remove after 5 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 5000);
}

// ─── Gemini API – Essay Generation ───────────────────────────

async function generateEssay() {
  if (!currentProfile) return alert(i18n.selectProfileFirst[currentLang]);

  const topic = document.getElementById('topic-input').value.trim();
  if (!topic) return alert(i18n.enterTopic[currentLang]);

  const requestedPages = Math.min(50, Math.max(5, parseInt(document.getElementById('page-count').value) || 15));
  document.getElementById('page-count').value = requestedPages;
  localStorage.setItem('essay_page_count', requestedPages);
  
  // Учитываем, что Титулка, Зміст и Список источников занимают ~3 страницы
  const textPages = Math.max(2, requestedPages - 3);
  
  // Calibrated from empirical data:
  // 3.3 paras/page + 330 words/page (w/o aggressive prompt) → 17 actual pages
  // 4.0 paras/page + 400 words/page (WITH aggressive prompt) → 27 actual pages
  // Target: 3.7 paras/page + 370 words/page (w/o aggressive prompt) → ~19 actual pages
  const totalParas = Math.ceil(textPages * 3.7);
  const introParas = Math.max(3, Math.ceil(totalParas * 0.12));
  const conclusionParas = Math.max(3, introParas);
  const remainingParas = totalParas - introParas - conclusionParas;
  const parasPerChapter = Math.max(4, Math.floor(remainingParas / 3));
  
  const wordsTarget = Math.ceil(textPages * 370);
  const minWordsPerPara = 80;
  const useSubsections = parasPerChapter >= 5;
  
  let chapterRules = "";
  if (!useSubsections) {
    chapterRules = `- РОЗДІЛ 1 – суцільний текст без підрозділів (${parasPerChapter} абзаців).
- РОЗДІЛ 2 – суцільний текст без підрозділів (${parasPerChapter} абзаців).
- РОЗДІЛ 3 – суцільний текст без підрозділів (${parasPerChapter} абзаців).
- Оскільки підрозділів немає, розміщуй текст безпосередньо у полі "text" об'єкта РОЗДІЛУ.`;
  } else {
    const subsCh1 = 2;
    const subsCh2 = Math.min(4, Math.max(2, Math.floor(parasPerChapter / 3)));
    const subsCh3 = Math.min(3, Math.max(2, Math.floor(parasPerChapter / 3)));
    
    const p1 = Math.max(2, Math.floor(parasPerChapter / subsCh1));
    const p2 = Math.max(2, Math.floor(parasPerChapter / subsCh2));
    const p3 = Math.max(2, Math.floor(parasPerChapter / subsCh3));

    chapterRules = `- РОЗДІЛ 1 – має містити ${subsCh1} підрозділи. Кожен підрозділ: ${p1}-${p1+1} абзаців.
- РОЗДІЛ 2 – має містити ${subsCh2} підрозділи. Кожен підрозділ: ${p2}-${p2+1} абзаців.
- РОЗДІЛ 3 – має містити ${subsCh3} підрозділи. Кожен підрозділ: ${p3}-${p3+1} абзаців.`;
  }

  const apiKeysRaw = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKeysRaw) return alert(i18n.noApiKey[currentLang]);
  const apiKeys = apiKeysRaw.split(/[,;\n]+/).map(k => k.trim()).filter(k => k);
  if (apiKeys.length === 0) return alert(i18n.noApiKey[currentLang]);
  // Look up the bibliography before asking the model to write. A model is very
  // good at prose but must not be trusted to invent bibliographic metadata.
  const loading = document.getElementById('loading-indicator');
  const generateBtn = document.getElementById('generate-btn');
  loading.classList.remove('hidden');
  generateBtn.disabled = true;
  document.getElementById('output-area').innerHTML = '';

  let verifiedSources;
  try {
    verifiedSources = await getVerifiedSources(topic);
  } catch (err) {
    loading.classList.add('hidden');
    generateBtn.disabled = false;
    const message = 'Не вдалося перевірити джерела в науковому каталозі. Перевірте інтернет-з’єднання і повторіть спробу.';
    sendNotification('Не перевірено джерела', message, true);
    alert(`${message}\n\n${err.message || err}`);
    return;
  }

  if (verifiedSources.length < MIN_VERIFIED_SOURCES) {
    sendNotification(
      'Джерел знайдено небагато',
      `Для цієї теми знайдено ${verifiedSources.length} перевірених україномовних джерел. Генерація продовжується без вигаданих або англомовних позицій.`
    );
  }

  // Build the requirements context from uploaded files
  let requirementsText = '';
  if (currentProfile.requirements && currentProfile.requirements.length > 0) {
    requirementsText = currentProfile.requirements.map(f => {
      return `--- ФАЙЛ ВИМОГ: ${f.name} ---\n${f.content}\n--- КІНЕЦЬ ФАЙЛУ ВИМОГ ---`;
    }).join('\n\n');
  } else {
    if (!confirm(i18n.noRequirements[currentLang] + '\n\nПродовжити?')) {
      loading.classList.add('hidden');
      generateBtn.disabled = false;
      return;
    }
  }

  // Build the examples context
  let exampleText = '';
  if (currentProfile.examples && currentProfile.examples.length > 0) {
    exampleText = currentProfile.examples.map(f => {
      return `--- ЗРАЗОК РЕФЕРАТУ: ${f.name} ---\n${f.content}\n--- КІНЕЦЬ ЗРАЗКА ---`;
    }).join('\n\n');
  }

  // Determine essay language
  const essayLang = currentLang === 'uk' ? 'українською мовою' : 'русском языке';
  const verifiedSourcesText = verifiedSources
    .map((source, index) => `S${index + 1}. ${source.citation}`)
    .join('\n');
  const useCitations = document.getElementById('citations-toggle')?.checked ?? false;
  const sourceCitationRule = useCitations 
    ? '- Встав у текст мінімум 4 посилання на джерела у форматі [1, с. 45], де 1 - це номер джерела, а 45 - сторінка. Не використовуй довге тире (— або –): використовуй лише звичайний дефіс (-).'
    : '- Не додавай внутрішньотекстових посилань, позначок у квадратних дужках, технічних маркерів або номерів джерел. Не використовуй довге тире (— або –): використовуй лише звичайний дефіс (-).';

  // ═══════════════════════════════════════════════════════════
  // NEW APPROACH: Ask AI for PLAIN TEXT only in JSON format.
  // All HTML structure is built programmatically below.
  // ═══════════════════════════════════════════════════════════
  const prompt = `Ти — професійний академічний помічник. Напиши повний реферат ${essayLang} на тему: "${topic}".

${requirementsText ? `
ВИМОГИ ВИКЛАДАЧА (дотримуйся їх щодо структури, обсягу, стилю):
${requirementsText}
` : ''}

${exampleText ? `
ЗРАЗКИ РЕФЕРАТІВ (ОРІЄНТУЙСЯ НА ЇХ СТИЛЬ, СТРУКТУРУ ТА СПОСІБ ПОДАННЯ ІНФОРМАЦІЇ):
${exampleText}
` : ''}

ПЕРЕВІРЕНІ ДЖЕРЕЛА ДЛЯ ЦІЄЇ РОБОТИ (це каталожні записи; використовуй лише їх):
${verifiedSourcesText}

- НЕ пиши назву підрозділу всередині поля "text". Поле "title" ВЖЕ містить назву, тому "text" має починатися ОДРАЗУ з першого абзацу тексту.
ВАЖЛИВО: Відповідай СТРОГО у форматі JSON (без markdown, без \`\`\`json, без нічого зайвого).
Формат відповіді — JSON-об'єкт:
{
  "discipline": "назва дисципліни (якщо є у вимогах, інакше 'Захист України')",
  "intro": "Повний текст вступу (3-5 абзаців, розділяй абзаци символом \\n\\n)",
  "sections": [
${useSubsections ? `    {
      "title": "НАЗВА РОЗДІЛУ 1 (ВЕЛИКИМИ ЛІТЕРАМИ)",
      "subsections": [
        {
          "title": "1.1 Назва підрозділу.",
          "text": "Повний текст підрозділу (абзаци розділяй \\n\\n)"
        }
      ]
    },
    {
      "title": "НАЗВА РОЗДІЛУ 2",
      "subsections": [
        {
          "title": "2.1 Назва підрозділу.",
          "text": "..."
        }
      ]
    },
    {
      "title": "НАЗВА РОЗДІЛУ 3",
      "subsections": [
        {
          "title": "3.1 Назва підрозділу.",
          "text": "..."
        }
      ]
    }` : `    {
      "title": "НАЗВА РОЗДІЛУ 1 (ВЕЛИКИМИ ЛІТЕРАМИ)",
      "text": "Повний текст розділу (без підрозділів, суцільний текст, абзаци розділяй \\n\\n)"
    },
    {
      "title": "НАЗВА РОЗДІЛУ 2 (ВЕЛИКИМИ ЛІТЕРАМИ)",
      "text": "Повний текст розділу..."
    },
    {
      "title": "НАЗВА РОЗДІЛУ 3 (ВЕЛИКИМИ ЛІТЕРАМИ)",
      "text": "Повний текст розділу..."
    }`}
  ],
  "conclusion": "Повний текст висновків (3-5 абзаців, \\n\\n між ними)",
  "sourceIds": ["S1", "S3", "S4"]
}

ПРАВИЛА ТА ОБСЯГ:
- Загальний обсяг реферату – РІВНО ${requestedPages} сторінок (шрифт 14pt Times New Roman, інтервал 1.5). Текстова частина має містити приблизно ${wordsTarget} слів. НЕ перевищуй цей обсяг! Не пиши більше ніж ${wordsTarget} слів!
- ВСТУП – ${introParas} абзаців.
${chapterRules}
- ВИСНОВКИ – ${conclusionParas} абзаців.
- У полі "sections" створи РІВНО 3 змістовні розділи. НІКОЛИ не додавай "ВИСНОВКИ" як розділ: пиши їх лише у полі "conclusion".
- СПИСОК ВИКОРИСТАНИХ ДЖЕРЕЛ програма додасть з перевіреного каталогу. У полі "sourceIds" вкажи 1-4 найбільш доречні коди S із каталогу. Не створюй поля "sources", не змінюй каталожні записи та не вигадуй нових позицій. У каталозі немає російськомовних або російських джерел; не додавай їх до тексту. Програма сама оформить список як звичайні бібліографічні записи без URL і DOI.
- НЕ використовуй маркіровані списки (крапки, дефіси) у тексті. Пиши суцільними абзацами.
- Якщо потрібен перелік, оформлюй його нумерованим текстом всередині абзацу.
${sourceCitationRule}
- Нумерація підрозділів має бути у форматі "1.1 Назва підрозділу." БЕЗ крапки після номеру, але З КРАПКОЮ В КІНЦІ НАЗВИ. Тобто НЕ "1.1." а "1.1", а в кінці назви ОБОВ'ЯЗКОВО крапка: "1.1 Поняття та сутність."
- НІКОЛИ не додавай номери сторінок у текст (цифри типу "18", "19" в кінці розділів). Нумерацію сторінок додає програма автоматично. Не вставляй жодних цифр-нумерацій сторінок.
- Відповідай ТІЛЬКИ JSON. Жодного тексту перед або після JSON.`;

  // ─── Retry helper: retries on 429/503 with exponential backoff ───
  async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, options);
      if (response.ok) return response;
      // Retry only on overload/rate-limit errors
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        const waitSec = Math.pow(2, attempt + 1) + Math.random() * 2; // 2-6s, 4-10s, 8-18s
        sendNotification('Модель перевантажена', `Автоповтор через ${Math.round(waitSec)} сек... (спроба ${attempt + 2}/${maxRetries + 1})`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      // Non-retryable error
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || response.statusText);
    }
  }

  try {
    let essayData = null;
    const maxGenRetries = 3;

    for (let genAttempt = 0; genAttempt < maxGenRetries; genAttempt++) {
      try {
        let text = '';
        let lastError = null;

    for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
      const currentKey = apiKeys[keyIdx];
      try {
        if (currentKey.startsWith('sk-')) {
          // ─── OpenAI ChatGPT API ───
          const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'Ти — професійний академічний помічник. Відповідай ТІЛЬКИ валідним JSON без markdown обгорток.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.7,
              max_tokens: 16000
            })
          });
          const data = await response.json();
          text = data?.choices?.[0]?.message?.content || '';
        } else {
          // ─── Google Gemini API (FREE) ───
          const useLiteModel = document.getElementById('lite-model-toggle').checked;
          const model = useLiteModel ? 'gemini-3.5-flash-lite' : 'gemini-3.6-flash';
          const response = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 65536,
                  responseMimeType: 'application/json',
                }
              })
            }, 5 // 5 retries even for lite model
          );
          const data = await response.json();
          text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        if (text) {
          lastError = null;
          break; // successfully got text
        } else {
          throw new Error('Empty response from API');
        }
      } catch (err) {
        lastError = err;
        console.warn(`Key failed (${currentKey.substring(0, 5)}...):`, err.message);
        if (keyIdx < apiKeys.length - 1) {
          sendNotification('Ключ вичерпано або помилка', `Перемикання на наступний API-ключ...`, false);
        }
      }
    }

    if (lastError && !text) {
          throw new Error(`Всі ключі вичерпано або помилка: ${lastError.message}`);
        }

        // Clean up markdown code fences if present
        text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        // Parse JSON
        try {
          essayData = JSON.parse(text);
        } catch (parseErr) {
          console.error('JSON parse error, raw text:', text);
          // Try to extract JSON from response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            essayData = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error(`AI не повернув валідний JSON: ${parseErr.message}`);
          }
        }

        // Successfully parsed, break out of retry loop
        break;

      } catch (err) {
        console.error(`Generation attempt ${genAttempt + 1} failed:`, err);
        if (genAttempt < maxGenRetries - 1) {
          sendNotification('Помилка', `Збій: ${err.message}. Повторюємо запит (${genAttempt + 2}/${maxGenRetries})...`, false);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw new Error(`Після ${maxGenRetries} спроб генерація не вдалася. Остання помилка: ${err.message}`);
        }
      }
    } // end genAttempt loop

    if (!essayData) {
      throw new Error("Не вдалося отримати дані реферату.");
    }
    normalizeEssayStructure(essayData);
    sanitizeEssayContent(essayData);
    
    // Never use source strings returned by the model. It may only select short
    // catalogue codes; the final bibliography still comes from verified records.
    const selectedSources = chooseSourcesForEssay(verifiedSources, essayData.sourceIds);
    const orderedSources = [...selectedSources]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'uk-UA'));
    essayData.sources = bibliographyFrom(orderedSources);

    // ═══════════════════════════════════════════════════════════
    // BUILD HTML PROGRAMMATICALLY — AI has zero control over formatting
    // ═══════════════════════════════════════════════════════════
    const html = buildEssayHTML(essayData, topic);
    document.getElementById('output-area').innerHTML = html;
    
    sendNotification('Готово!', 'Генерація реферату успішно завершена.');

  } catch (err) {
    console.error('Generation error:', err);
    sendNotification('Помилка', 'Сталася помилка при генерації: ' + err.message, true);
    alert(i18n.errorGenerate[currentLang] + '\n\n' + err.message);
  } finally {
    loading.classList.add('hidden');
    generateBtn.disabled = false;
  }
}

// ─── Build Essay HTML from structured data ───────────────────

function textToParas(text) {
  // Split text by double newlines into paragraphs
  if (!text) return '';
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p class="para">${escapeHtml(p)}</p>`)
    .join('\n');
}

function titleBlankLines(count) {
  return Array.from({ length: count }, () => '<p class="title-blank">&nbsp;</p>').join('\n');
}

function buildEssayHTML(data, topic) {
  const customDiscipline = document.getElementById('discipline-input')?.value?.trim();
  const discipline = customDiscipline || data.discipline || 'Захист України';

  // ═══ 1. TITLE PAGE (SECTION 1) ═══
  const titlePage = `
<div class="Section1">
  <div class="title-top">
    НАЦІОНАЛЬНИЙ УНІВЕРСИТЕТ<br>
    «ОДЕСЬКА ЮРИДИЧНА АКАДЕМІЯ»<br>
    КРИВОРІЗЬКИЙ ЮРИДИЧНИЙ ФАХОВИЙ КОЛЕДЖ
  </div>
  ${titleBlankLines(5)}
  <div class="title-middle">
    <div class="essay-word">РЕФЕРАТ</div>
    <div class="discipline-line">з навчальної дисципліни ${escapeHtml(discipline)}</div>
    <div class="topic-line">на тему: «${escapeHtml(topic)}»</div>
  </div>
  ${titleBlankLines(6)}
  <table width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td width="50%"></td>
      <td width="50%" style="text-align: left; font-size: 14pt; line-height: 150%; font-family: 'Times New Roman', Times, serif;">
        Виконала (-в):<br>
        Студент (-тка) 1 курсу групи 25 КД<br>
        Прізвище, імʼя, по-батькові<br>
        <br>
        Викладач навчальної дисципліни:<br>
        Чернецький Андрій Олегович
      </td>
    </tr>
  </table>
  ${titleBlankLines(2)}
  <div class="title-bottom">
    Кривий Ріг<br>
    2026
    <p style="margin:0; padding:0; font-size:0pt; line-height:0pt;"><br clear="all" style="page-break-before:always; mso-break-type:section-break" /></p>
  </div>
</div>
<div class="WordSection2">`;

  // ═══ 2. TABLE OF CONTENTS ═══
  const tocPage = `
<div class="toc-container">
  <p class="toc-title">ЗМІСТ</p>
  <p class="MsoToc1 toc-field" style="margin:0; text-align:left; text-indent:0; font-family:'Times New Roman', Times, serif; font-size:14pt; mso-bidi-font-size:14pt; line-height:150%; mso-line-height-alt:21pt; mso-line-height-rule:exactly;">
    <!--[if supportFields]>
    <span style='mso-element:field-begin'></span>
    <span style='mso-spacerun:yes'> </span><span style='font-family:"Times New Roman", Times, serif; font-size:14pt; mso-bidi-font-size:14pt; line-height:150%; mso-line-height-alt:21pt;'>TOC \\o "1-2" \\h \\z \\u \\* CHARFORMAT \\* MERGEFORMAT</span>
    <span style='mso-element:field-separator'></span>
    <![endif]-->
    <span style='mso-no-proof:yes; font-family:"Times New Roman", Times, serif; font-size:14pt; mso-bidi-font-size:14pt; line-height:150%; mso-line-height-alt:21pt;'>
      <i>Тут буде знаходитися автоматичний зміст. У Word натисніть будь-де на цьому тексті правою кнопкою миші та оберіть "Оновити поле" (Update Field).</i>
    </span>
    <!--[if supportFields]>
    <span style='mso-element:field-end'></span>
    <![endif]-->
  </p>
</div>`;

  // ═══ 3. INTRODUCTION ═══
  const introSection = `
<p style="margin:0; padding:0; font-size:0pt; line-height:0pt;"><br clear="all" style="mso-special-character:line-break; page-break-before:always" /></p>
<p class="MsoHeading1 structural-heading" style="margin-top:0;">ВСТУП</p>
${textToParas(data.intro)}
`;

  // ═══ 4. MAIN SECTIONS ═══
  let mainSections = '';
  if (data.sections && data.sections.length > 0) {
    data.sections.forEach((section, i) => {
      const sectionNum = i + 1;
      let cleanTitle = String(section.title || '').replace(/^(?:розділ|глава)\s*\d+\.?\s*/i, '');
      cleanTitle = cleanTitle.replace(/[\r\n]+/g, ' ').trim();
      const sectionTitle = (cleanTitle || 'ОСНОВНІ ПОЛОЖЕННЯ').toLocaleUpperCase('uk-UA');
      mainSections += `<p style="margin:0; padding:0; font-size:0pt; line-height:0pt;"><br clear="all" style="mso-special-character:line-break; page-break-before:always" /></p>\n`;
      mainSections += `<p class="MsoHeading1 section-heading" style="margin-top:0;">РОЗДІЛ ${sectionNum}<br>${escapeHtml(sectionTitle)}</p>\n`;
      
      if (section.text) {
        mainSections += textToParas(section.text) + '\n';
      }

      if (section.subsections && section.subsections.length > 0) {
        section.subsections.forEach(sub => {
          let subTitle = sub.title || '';
          
          // AI sometimes puts the title inside sub.text instead of sub.title, or duplicates it.
          // Check if sub.text starts with a title pattern.
          let textParts = sub.text.split(/\n\n+/);
          let firstPara = textParts[0] ? textParts[0].trim() : '';
          
          if (firstPara && /^[\s\*]*(\d+\.\d+)\.?\s+/.test(firstPara)) {
            // It might contain just the title, OR the title and text separated by a single newline.
            let lines = firstPara.split('\n');
            let firstLine = lines[0].trim();
            if (/^[\s\*]*(\d+\.\d+)\.?\s+/.test(firstLine)) {
              if (!subTitle) {
                subTitle = firstLine;
              }
              // Remove the title line from text
              lines.shift();
              if (lines.length > 0) {
                textParts[0] = lines.join('\n'); // keep the rest of the paragraph
              } else {
                textParts.shift(); // remove completely if it was just the title
              }
            }
          }
          
          sub.text = textParts.join('\n\n');

          // Clean up the subTitle
          if (subTitle) {
            // Strip HTML and Markdown bold just in case
            subTitle = subTitle.replace(/<[^>]*>/g, '').replace(/\*\*/g, '').trim();
            // Fix "1.1." → "1.1" (remove dot right after subsection number)
            subTitle = subTitle.replace(/^(\d+\.\d+)\.\s*/, '$1 ');
            // Remove trailing dot if any, then add exactly one
            subTitle = subTitle.replace(/\s*\.\s*$/, '').trim();
            subTitle = subTitle.replace(/[\r\n]+/g, ' '); // Fix Word splitting headings
            if (subTitle.length > 0 && !subTitle.endsWith('.')) {
              subTitle += '.';
            }
            mainSections += `<p class="MsoHeading2 subsection-heading">${escapeHtml(subTitle)}</p>\n`;
          }
          
          mainSections += textToParas(sub.text) + '\n';
        });
      }
    });
  }

  // ═══ 5. CONCLUSION ═══
  const conclusionSection = `
<p style="margin:0; padding:0; font-size:0pt; line-height:0pt;"><br clear="all" style="mso-special-character:line-break; page-break-before:always" /></p>
<p class="MsoHeading1 structural-heading" style="margin-top:0;">ВИСНОВКИ</p>
${textToParas(data.conclusion)}
`;

  // ═══ 6. REFERENCES ═══
  let sourcesHTML = '';
  if (data.sources && data.sources.length > 0) {
    sourcesHTML = data.sources.map((s, i) => {
      const cleanSource = s.replace(/^\d+\.\s*/, '');
      return `<p class="para source-item">${i + 1}. ${escapeHtml(cleanSource)}</p>`;
    }).join('\n');
  }
  const referencesSection = `
<p style="margin:0; padding:0; font-size:0pt; line-height:0pt;"><br clear="all" style="mso-special-character:line-break; page-break-before:always" /></p>
<p class="MsoHeading1 structural-heading" style="margin-top:0;">СПИСОК ВИКОРИСТАНИХ ДЖЕРЕЛ</p>
${sourcesHTML}`;

  // ═══ COMBINE ALL ═══
  return titlePage + tocPage + introSection + mainSections + conclusionSection + referencesSection + `\n</div>`;
}

// ─── Export ──────────────────────────────────────────────────

function exportDocx() {
  const content = document.getElementById('output-area').innerHTML;
  if (!content || content.includes('placeholder-text')) return;
  
  const pageNumPos = document.getElementById('page-number-position')?.value || 'bottom-right';
  const pageNumOnTop = pageNumPos.startsWith('top');
  const pageNumAlign = pageNumPos.includes('right') ? 'right' : (pageNumPos.includes('left') ? 'left' : 'center');

  // Read margins from inputs (mm) and convert to pt (1mm ≈ 2.835pt)
  const mTop = parseInt(document.getElementById('margin-top')?.value) || 20;
  const mBottom = parseInt(document.getElementById('margin-bottom')?.value) || 20;
  const mLeft = parseInt(document.getElementById('margin-left')?.value) || 20;
  const mRight = parseInt(document.getElementById('margin-right')?.value) || 10;
  const ptTop = (mTop * 2.835).toFixed(1);
  const ptBottom = (mBottom * 2.835).toFixed(1);
  const ptLeft = (mLeft * 2.835).toFixed(1);
  const ptRight = (mRight * 2.835).toFixed(1);

  const headerMarginPt = pageNumOnTop ? '28.35pt' : '0pt';
  const footerMarginPt = pageNumOnTop ? '0pt' : '28.35pt';
  const headerFooterRef = pageNumOnTop ? 'mso-header: h1;' : 'mso-footer: f1;';
  // (emptyHeaderFooterRef removed - Section1 has no header/footer reference)

  const styles = `
    <style>
      /* ══ Сторінка ══ */
      @page {
        size: A4;
        margin: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm;
      }
      @page WordSection1 {
        size: 595.3pt 841.9pt;
        margin: ${ptTop}pt ${ptRight}pt ${ptBottom}pt ${ptLeft}pt;
        mso-header-margin: 0pt;
        mso-footer-margin: 0pt;
        /* no mso-header/mso-footer - title page has no page number */
      }
      div.Section1 { page: WordSection1; }
      
      @page WordSection2 {
        size: 595.3pt 841.9pt;
        margin: ${ptTop}pt ${ptRight}pt ${ptBottom}pt ${ptLeft}pt;
        mso-header-margin: ${headerMarginPt};
        mso-footer-margin: ${footerMarginPt};
        ${headerFooterRef}
      }
      div.WordSection2 { page: WordSection2; }
      
      body {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        color: #000000;
        margin: 0;
        padding: 0;
        background: #fff;
      }

      /* ══ Титульна сторінка ══ */
      .Section1 {
        text-align: center;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
      }
      .title-top {
        text-align: center;
        font-size: 14pt;
        font-weight: bold;
        line-height: 150%;
      }
      .title-middle {
        text-align: center;
      }
      .title-middle .essay-word {
        font-size: 14pt;
        font-weight: bold;
      }
      .title-middle .discipline-line {
        font-size: 14pt;
      }
      .title-middle .topic-line {
        font-size: 14pt;
      }
      .title-bottom {
        text-align: center;
        font-size: 14pt;
      }
      p.title-blank {
        margin: 0 !important;
        padding: 0;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        text-align: center !important;
        text-indent: 0 !important;
      }

      /* ══ TOC ══ */
      p.toc-title {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        line-height: 150%;
        text-align: center;
        text-indent: 0;
        margin: 0 0 0.3cm 0;
        padding: 0;
      }
      p.toc-field, p.toc-item {
        text-indent: 0 !important;
        margin: 0 !important;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        text-align: left;
      }
      /* MSO TOC styles — Word uses these when it regenerates the TOC field */
      p.MsoToc1, p.MsoToc2, p.MsoToc3, p.TOC1, p.TOC2, p.TOC3,
      li.MsoToc1, li.MsoToc2, li.MsoToc3, li.TOC1, li.TOC2, li.TOC3,
      div.MsoToc1, div.MsoToc2, div.MsoToc3, div.TOC1, div.TOC2, div.TOC3 {
        mso-style-noshow: no;
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt !important;
        mso-bidi-font-size: 14pt;
        line-height: 150% !important;
        mso-line-height-alt: 21.0pt;
        mso-line-height-rule: exactly;
        margin: 0 !important;
        text-indent: 0 !important;
        text-align: left;
      }
      p.MsoToc1 span, p.MsoToc2 span, p.MsoToc3 span, p.TOC1 span, p.TOC2 span, p.TOC3 span,
      li.MsoToc1 span, li.MsoToc2 span, li.MsoToc3 span, li.TOC1 span, li.TOC2 span, li.TOC3 span {
        font-family: 'Times New Roman', Times, serif !important;
        font-size: 14pt !important;
        mso-bidi-font-size: 14pt;
        line-height: 150% !important;
        mso-line-height-alt: 21.0pt;
      }
      p.MsoToc2, p.TOC2 {
        margin-left: 1.25cm;
      }
      p.MsoToc3, p.TOC3 {
        margin-left: 2.5cm;
      }

      /* ══ Заголовки ══ */
      p.MsoHeading1 {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        text-align: center !important;
        text-transform: uppercase;
        margin-top: 0cm;
        margin-bottom: 0.3cm;
        margin-left: 0 !important;
        margin-right: 0 !important;
        text-indent: 0 !important;
        mso-outline-level: 1;
        mso-para-margin-top: 0cm;
        mso-para-margin-bottom: .3cm;
        mso-style-next: Normal;
        mso-pagination: none;
        page-break-before: auto;
      }
      p.MsoHeading2 {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        font-weight: bold;
        text-align: center !important;
        text-transform: none;
        margin-top: 0.5cm;
        margin-bottom: 0.2cm;
        margin-left: 0 !important;
        margin-right: 0 !important;
        text-indent: 0 !important;
        mso-outline-level: 2;
        page-break-after: avoid;
      }
      p.MsoHeading1.structural-heading, p.MsoHeading1.section-heading {
        margin-top: 0 !important;
        mso-para-margin-top: 0cm;
      }

      /* ══ Абзаци основного тексту ══ */
      p, .para {
        font-family: 'Times New Roman', Times, serif;
        font-size: 14pt;
        line-height: 150%;
        text-align: justify;
        text-indent: 1.25cm;
        margin: 0;
        padding: 0;
        orphans: 15;
        widows: 15;
      }
      /* Match the supplied sample: numbering starts after the normal first
         line indent; wrapped lines return to the left text margin. */
      p.source-item {
        text-indent: 1.25cm !important;
        text-align: justify !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    </style>
  `;

  // ── Post-process HTML for Word compatibility ──
  let processed = content;

  // 0. Ensure all h3 subsection titles are formatted correctly ("1.1 Title.")
  processed = processed.replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/gi, function(match, attrs, inner) {
    // Decode common entities just for checking
    let pureText = inner.replace(/<[^>]*>/g, '')
                        .replace(/&nbsp;/gi, ' ')
                        .replace(/&amp;/gi, '&')
                        .trim();
    
    // Check if it ends with a dot
    let needsDot = pureText.length > 0 && !pureText.endsWith('.');

    // Also, we need to remove the dot right after the subsection number (e.g. "1.1. " -> "1.1 ")
    // Since inner might have HTML tags like <b>1.1.</b>, we should do a careful replace on the inner HTML.
    // This regex looks for a digit.digit followed by a dot, optionally wrapped in tags.
    // A simpler way is to just do a text replace on the inner string:
    let newInner = inner.replace(/^(\s*(?:<[^>]*>\s*)*\d+\.\d+)\.\s*/, '$1 ');

    if (needsDot) {
      // Remove trailing whitespace/nbsp from HTML string before adding dot
      newInner = newInner.replace(/(?:\s|&nbsp;)+$/, '') + '.';
    }

    return '<h3' + attrs + '>' + newInner + '</h3>';
  });

  // 1. Remove display:flex / flexbox (Word doesn't support it)
  processed = processed.replace(/display\s*:\s*flex\s*;?/gi, '');
  processed = processed.replace(/flex-direction\s*:[^;";]+;?/gi, '');
  processed = processed.replace(/justify-content\s*:[^;";]+;?/gi, '');
  processed = processed.replace(/align-items\s*:[^;";]+;?/gi, '');

  // 2. Fix right-block: Word ignores margin-left %, replace with table
  processed = processed.replace(
    /<div([^>]*class="[^"]*right-block[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi,
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="55%"></td>' +
    '<td width="45%" style="font-family:\'Times New Roman\',serif;font-size:14pt;line-height: 150%;vertical-align:top;">$2</td>' +
    '</tr></table>'
  );

  // Build full MSO HTML document — Word opens this format natively
  const header =
    "\ufeff" + // UTF-8 BOM for correct encoding detection
    "<!DOCTYPE html>\n" +
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'>\n" +
    "<head>\n" +
    "<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>\n" +
    "<title>Реферат</title>\n" +
    "<!--[if gte mso 9]><xml><w:WordDocument>" +
    "<w:View>Print</w:View>" +
    "<w:Zoom>100</w:Zoom>" +
    "<w:UpdateFields>true</w:UpdateFields>" +
    "<w:DoNotOptimizeForBrowser/>" +
    "</w:WordDocument></xml>" +
    "<xml><w:LatentStyles DefLockedState='false' DefUnhideWhenUsed='false' DefSemiHidden='false' DefQFormat='false' DefPriority='99'>" +
    "</w:LatentStyles></xml>" +
    "<![endif]-->\n" +
    styles +
    "\n</head>\n<body lang=\"UK\">\n";
  const elemType = pageNumOnTop ? 'header' : 'footer';
  const elemId = pageNumOnTop ? 'h1' : 'f1';
  const msoCls = pageNumOnTop ? 'MsoHeader' : 'MsoFooter';

  // Page number definition wrapped in MSO conditional comment:
  // - Word (MSO>=9) sees and processes the mso-element definition
  // - Browsers/print-preview DON'T see it at all (no phantom "1")
  // - Uses mso-field-code instead of nested <!--[if supportFields]--> to avoid
  //   comment nesting issues
  const pageNumDef =
    '<!--[if gte mso 9]>' +
    '<div style="mso-element:' + elemType + '" id="' + elemId + '">' +
    '<p class="' + msoCls + '" align="' + pageNumAlign + '" ' +
    'style="margin:0;text-align:' + pageNumAlign + ';font-family:Times New Roman,serif;font-size:14pt">' +
    "<span style='mso-field-code:\" PAGE  \\* MERGEFORMAT \"'>2</span>" +
    '</p></div>' +
    '<![endif]-->';

  // Inject INSIDE WordSection2 — the ONLY placement that produces page numbers.
  // The MSO conditional wrapper prevents the phantom "1" from appearing.
  processed = processed.replace(
    /(<div\s+class="WordSection2">)/i,
    '$1\n' + pageNumDef + '\n'
  );

  const footer = "\n</body>\n</html>";
  const sourceHTML = header + processed + footer;

  // Create blob with proper MIME type for Word
  const blob = new Blob([sourceHTML], {
    type: 'application/msword;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'referat.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
