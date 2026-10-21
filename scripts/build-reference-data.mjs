/**
 * Gera os dados de referência do módulo de finanças, commitados como JSON:
 *
 * - `feriados-anbima.json` — feriados bancários nacionais;
 * - `cdi-sgs12-seed.json`  — série 12 do SGS (CDI ao dia útil, em percentual).
 *
 * **Script de desenvolvimento, rodado à mão.** Nunca em runtime, nunca em
 * teste: o artefato que importa é o JSON commitado, e é ele que os testes
 * validam. Rode com `node scripts/build-reference-data.mjs`.
 *
 * Sobre os feriados: o arquivo oficial da ANBIMA é um `.xls` binário, e baixá-lo
 * exigiria uma dependência de parser que só serviria uma vez. A lista abaixo é
 * gerada a partir das regras legais que a própria ANBIMA aplica — feriados
 * nacionais fixos das Leis 662/1949, 6.802/1980 e 14.759/2023, mais os móveis
 * ancorados na Páscoa (Carnaval, Sexta-feira Santa e Corpus Christi). O teste
 * `reference-data.test.ts` confere as datas de amostra contra a publicação da
 * ANBIMA. Se a lista divergir algum dia, corrija aqui e regenere.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../packages/db/src/migrations/data");

const FIRST_YEAR = 1999;
const LAST_YEAR = 2099;
/** A série 12 do SGS começa bem antes, mas 2018 já cobre qualquer caixinha. */
const CDI_FROM = "2018-01-01";
/**
 * Fim **fixo** da semente. Os testes contam com o último dia semeado (a taxa
 * de 17 e 18/09 é a que eles conferem), e o resto da série a API busca em
 * runtime. Baixar "até hoje" fazia cada regeneração mudar o arquivo e quebrar
 * os testes. Para estender a semente, mude aqui e atualize os testes juntos.
 */
const CDI_TO = "2026-09-18";

// --- Feriados ---------------------------------------------------------------

const pad = (value) => String(value).padStart(2, "0");
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/** Domingo de Páscoa pelo algoritmo gregoriano anônimo. */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const shift = (base, days) => {
  const date = new Date(base + days * 86_400_000);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

function holidaysFor(year) {
  const pascoa = easter(year);
  const list = [
    { date: iso(year, 1, 1), name: "Confraternização Universal" },
    // Carnaval: segunda e terça, 48 e 47 dias antes da Páscoa.
    { date: shift(pascoa, -48), name: "Carnaval" },
    { date: shift(pascoa, -47), name: "Carnaval" },
    { date: shift(pascoa, -2), name: "Sexta-feira Santa" },
    { date: iso(year, 4, 21), name: "Tiradentes" },
    { date: iso(year, 5, 1), name: "Dia do Trabalho" },
    { date: shift(pascoa, 60), name: "Corpus Christi" },
    { date: iso(year, 9, 7), name: "Independência do Brasil" },
    { date: iso(year, 10, 12), name: "Nossa Senhora Aparecida" },
    { date: iso(year, 11, 2), name: "Finados" },
    { date: iso(year, 11, 15), name: "Proclamação da República" },
    { date: iso(year, 12, 25), name: "Natal" }
  ];
  // Consciência Negra virou feriado nacional pela Lei 14.759/2023.
  if (year >= 2024) {
    list.push({ date: iso(year, 11, 20), name: "Consciência Negra" });
  }
  return list;
}

function buildHolidays() {
  const all = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) all.push(...holidaysFor(year));

  // Feriado móvel pode cair em cima de um fixo: em 2000 e em 2079 a
  // Sexta-feira Santa cai em 21 de abril, Tiradentes. É um dia só, e a ANBIMA
  // também o lista uma vez.
  const byDate = new Map();
  for (const item of all) {
    const existing = byDate.get(item.date);
    if (existing) {
      if (!existing.name.includes(item.name)) existing.name = `${existing.name} / ${item.name}`;
      continue;
    }
    byDate.set(item.date, { ...item });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// --- CDI --------------------------------------------------------------------

const toBr = (isoDate) => {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
};

const fromBr = (brDate) => {
  const [day, month, year] = brDate.split("/");
  return `${year}-${month}-${day}`;
};

/** A API devolve 406 para intervalos maiores que 10 anos. */
function windows(from, to) {
  const result = [];
  let start = Number(from.slice(0, 4));
  const end = Number(to.slice(0, 4));
  while (start <= end) {
    const stop = Math.min(start + 9, end);
    result.push([`${start}-01-01`, stop === end ? to : `${stop}-12-31`]);
    start = stop + 1;
  }
  return result;
}

async function fetchSeries(from, to) {
  const rows = [];
  for (const [start, stop] of windows(from, to)) {
    const url =
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json" +
      `&dataInicial=${toBr(start)}&dataFinal=${toBr(stop)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`SGS respondeu ${response.status} para ${start}..${stop}`);
    const text = await response.text();
    // O front-end do BCB às vezes devolve HTML de erro com status 200.
    if (!text.trimStart().startsWith("[")) {
      throw new Error(`SGS devolveu conteudo nao-JSON para ${start}..${stop}`);
    }
    for (const item of JSON.parse(text)) {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(item.data)) continue;
      if (!/^-?\d+(\.\d+)?$/.test(item.valor)) continue;
      rows.push({ date: fromBr(item.data), dailyRatePercent: Number(item.valor) });
    }
    process.stdout.write(`.`);
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Execução ---------------------------------------------------------------

const holidays = buildHolidays();
writeFileSync(
  resolve(dataDir, "feriados-anbima.json"),
  `${JSON.stringify(holidays, null, 0)}\n`
);
console.log(`feriados: ${holidays.length} linhas`);

console.log("baixando a serie 12 do SGS");
const rates = await fetchSeries(CDI_FROM, CDI_TO);
writeFileSync(
  resolve(dataDir, "cdi-sgs12-seed.json"),
  `${JSON.stringify(rates, null, 0)}\n`
);
console.log(`\ncdi: ${rates.length} linhas, de ${rates[0]?.date} a ${rates.at(-1)?.date}`);
